import { requestAgent } from '@metis/knowledge-index/external-agent';
import { queryAi, generateProposal } from '@metis/knowledge-index/ai-provider';
import type { AiRequest, ProposalRequest } from '@metis/contracts';
import type { SemanticDiffRequest, SemanticDiffResult } from '@metis/contracts';
import type { ContextRequest, ContextBundle } from '@metis/contracts';
import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { PreviewWorker } from './preview-worker';
import type { OperationRequest, RelationIndex, GitVersionRequest } from '@metis/contracts';
import { GitWorkspace } from '@metis/workspace';
import { ExternalEditor, LaunchQueue } from '@metis/workspace';
import type { LaunchRequest, Session } from '@metis/contracts';
import { promises as fs } from 'node:fs';
import type { SaveRequest, AnalyzeRequest, SearchRequest, SearchResults, CopyRequest, RecoveryRequest, FileChangeRequest, FileChangeApply } from '@metis/contracts';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { channels, protocolVersion, validate, failure, BoundaryError, type Method, type PathRequest, type ScopedRequest, type NamedRequest, type RecentRequest, type CreateDirectoryRequest } from '@metis/contracts';
import { Workspace, fileError, createWorkspaceFolder, Recents, Recovery, FileChanges } from '@metis/workspace';
if (process.env.METIS_USER_DATA) app.setPath('userData', process.env.METIS_USER_DATA);
const launchQueue = new LaunchQueue();
const appArgument = process.defaultApp ? process.argv.findIndex((value, index) => index > 0 && !value.startsWith('-') && path.resolve(value) === path.resolve(app.getAppPath())) : 0;
const launchArgs = process.argv.slice(appArgument > 0 ? appArgument + 1 : 1);
while (launchArgs[0]?.match(/^--(?:inspect(?:-brk)?|remote-debugging-port)=/)) launchArgs.shift();
const ownsLock = app.requestSingleInstanceLock({ args: launchArgs, cwd: process.cwd() });
let launchWindow: BrowserWindow | undefined;
if (!ownsLock) app.quit();
else {
  launchQueue.add(launchArgs, process.cwd());
  app.on('second-instance', (_event, _argv, cwd, data) => {
    const input = data as { args?: unknown; cwd?: unknown };
    if (Array.isArray(input.args) && input.args.length <= 20 && input.args.every(value => typeof value === 'string' && value.length <= 4096)) {
      if (!launchQueue.add(input.args, typeof input.cwd === 'string' ? input.cwd : cwd)) console.error('CLI queue full; retry after pending requests complete.');
    }
    if (launchWindow) { if (launchWindow.isMinimized()) launchWindow.restore(); launchWindow.show(); launchWindow.focus(); }
  });
}
const recoveryRoot = path.join(app.getPath('userData'), 'recovery');
const workspace = new Workspace(recoveryRoot);
const fileChanges = new FileChanges(workspace);
const git = new GitWorkspace(workspace);
let gitBusy = false;
let selecting = false;
let currentSession: Session | undefined, currentRoot: string | undefined;
const externalEditor = new ExternalEditor(path.join(app.getPath('userData'), 'external-editor.json'));
if (ownsLock) app.whenReady().then(() => {
  const recents = new Recents(path.join(app.getPath('userData'), 'recent-workspaces.json'));
  const searchWorker = new PreviewWorker<SearchRequest, SearchResults>(path.join(__dirname, '../utility/utility.cjs'), 'search', 10000);
  const semanticWorker = new PreviewWorker<SemanticDiffRequest, SemanticDiffResult>(path.join(__dirname, '../utility/utility.cjs'), 'semantic-diff', 15000);
  const contextWorker = new PreviewWorker<ContextRequest, ContextBundle>(path.join(__dirname, '../utility/utility.cjs'), 'context', 15000);
  const relationsWorker = new PreviewWorker<ScopedRequest, RelationIndex>(path.join(__dirname, '../utility/utility.cjs'), 'relations', 15000);
  let aiController: AbortController | undefined, aiBundle: ContextBundle | undefined;
  let agentProgress: { id: string; message: string } | undefined;
  let proposalController: AbortController | undefined;
  const resetAi = () => { agentProgress = undefined; proposalController?.abort(); proposalController = undefined; aiController?.abort(); aiController = undefined; aiBundle = undefined; };
  const open = async (root: string) => {
    const session = await workspace.open(root);
    resetAi(); currentSession = session; currentRoot = workspace.analysisRoot({ requestId: 'root', ...session });
    semanticWorker.stop('작업 공간이 변경되어 의미 비교를 취소했습니다.');
    contextWorker.stop('작업 공간이 변경되어 맥락 구성을 취소했습니다.');
    searchWorker.stop('작업 공간이 변경되어 검색을 취소했습니다.');
    relationsWorker.stop('작업 공간이 변경되어 관계 조사를 취소했습니다.');
    try { await recents.record(root); } catch { session.warning = '폴더는 열었지만 최근 작업 공간 기록을 저장하지 못했습니다.'; }
    return session;
  };
  const preview = new PreviewWorker(path.join(__dirname, '../utility/utility.cjs'));
  app.on('before-quit', () => { resetAi(); preview.stop(); searchWorker.stop(); relationsWorker.stop(); contextWorker.stop(); semanticWorker.stop(); });
  const entry = path.join(__dirname, '../renderer/index.html');
  const window = new BrowserWindow({ width: 1180, height: 800, show: !process.argv.includes('--smoke'),
    webPreferences: { preload: path.join(__dirname, '../preload/preload.cjs'), sandbox: true, contextIsolation: true, nodeIntegration: false } });
  launchWindow = window;
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const discard = () => dialog.showMessageBoxSync(window, { type: 'warning', title: '저장하지 않은 변경', message: '저장하지 않은 편집 내용이 있습니다.', detail: '저장하려면 계속 편집을 선택한 뒤 저장 버튼을 눌러 주세요.', buttons: ['계속 편집', '저장하지 않고 닫기'], defaultId: 0, cancelId: 0 }) === 1;
  window.on('close', event => { if (selecting) event.preventDefault(); });
  window.webContents.on('will-prevent-unload', event => { if (!selecting && discard()) event.preventDefault(); });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_wc, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  for (const method of Object.keys(channels) as Method[]) {
    ipcMain.handle(channels[method], async (event, payload: unknown) => {
      let requestId = 'invalid';
      try {
        if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== pathToFileURL(entry).href)
          throw new BoundaryError('ACCESS_DENIED', '허용되지 않은 요청입니다.');
        const request = validate(method, payload);
        requestId = request.requestId;
        if (selecting && ['applyLaunch', 'configureEditor', 'openExternal', 'externalDecision', 'previewFileChange', 'applyFileChange', 'copyDocument', 'checkpointDocument', 'openWorkspace', 'createWorkspace', 'openRecentWorkspace', 'closeWorkspace', 'createDirectory', 'createDocument', 'saveDocument'].includes(method))
          throw new BoundaryError('BUSY', '진행 중인 폴더 작업을 완료해 주세요.');
        let value: unknown;
        switch (method) {
          case 'pendingLaunch': {
            const item = launchQueue.peek(); let sameWorkspace = false;
            if (item?.target) { try { sameWorkspace = await fs.realpath(item.target.root) === currentRoot; } catch { /* Validation occurs when applying. */ } }
            value = item ? { id: item.id, sameWorkspace, error: item.error } : null; break;
          }
          case 'dismissLaunch': launchQueue.take((request as LaunchRequest).launchId); value = null; break;
          case 'applyLaunch': {
            selecting = true;
            try {
              const item = launchQueue.take((request as LaunchRequest).launchId); if (!item.target) throw new BoundaryError('INVALID_REQUEST', item.error ?? 'CLI 요청을 확인하세요.');
              const target = item.target, check = new Workspace(), checked = await check.open(target.root);
              if (target.relativePath) await check.read({ requestId: 'cli-check', ...checked, relativePath: target.relativePath });
              const root = check.analysisRoot({ requestId: 'cli-root', ...checked });
              const session = currentSession && root === currentRoot ? currentSession : await open(root);
              value = { session, relativePath: target.relativePath, line: target.line };
            } finally { selecting = false; }
            break;
          }
          case 'configureEditor': {
            selecting = true;
            try { const selected = await dialog.showOpenDialog(window, { title: '외부 편집기 실행 파일 선택', properties: ['openFile'], ...(process.platform === 'win32' ? { filters: [{ name: '실행 파일', extensions: ['exe'] }] } : {}) }); if (selected.canceled || !selected.filePaths[0]) throw new BoundaryError('CANCELLED', '편집기 선택을 취소했습니다.'); if (await fs.realpath(selected.filePaths[0]) === await fs.realpath(process.execPath)) throw new BoundaryError('INVALID_REQUEST', 'Metis가 아닌 외부 편집기를 선택하세요.'); value = await externalEditor.configure(selected.filePaths[0]); }
            finally { selecting = false; } break;
          }
          case 'externalDecision': value = ['save', 'disk', 'cancel'][dialog.showMessageBoxSync(window, { type: 'question', title: '외부 편집기 열기', message: '저장하지 않은 편집 내용이 있습니다.', detail: '저장본만 열면 Metis의 미저장 편집은 유지됩니다. 외부 변경은 이후 충돌 검사로 확인합니다.', buttons: ['저장 후 열기', '저장본만 열기', '취소'], defaultId: 2, cancelId: 2 })] ?? 'cancel'; break;
          case 'openExternal': selecting = true; try { value = await externalEditor.open(await workspace.externalPath(request as PathRequest)); } finally { selecting = false; } break;
          case 'gitStatus':
          case 'gitFile':
          case 'gitVersion':
            if (gitBusy) throw new BoundaryError('BUSY', '진행 중인 Git 조회가 끝난 뒤 다시 시도하세요.');
            gitBusy = true;
            try { value = method === 'gitStatus' ? await git.status(request as ScopedRequest) : method === 'gitFile' ? await git.file(request as PathRequest) : await git.version(request as GitVersionRequest); }
            finally { gitBusy = false; }
            break;
          case 'semanticDiff': {
            const scoped = request as SemanticDiffRequest; value = await semanticWorker.analyze(workspace.analysisRoot(scoped), scoped); workspace.analysisRoot(scoped); break;
          }
          case 'cancelSemanticDiff': workspace.analysisRoot(request as ScopedRequest); semanticWorker.stop('의미 비교를 취소했습니다.'); value = null; break;
          case 'agentProgress': { workspace.analysisRoot(request as ScopedRequest); if (agentProgress?.id !== (request as OperationRequest).operationId) throw new BoundaryError('NOT_FOUND', '진행 중인 Agent 요청이 없습니다.'); value = agentProgress.message; break; }
          case 'cancelProposal': workspace.analysisRoot(request as ScopedRequest); proposalController?.abort(); proposalController = undefined; agentProgress = undefined; value = null; break;
          case 'generateProposal': {
            const scoped = request as ProposalRequest; workspace.analysisRoot(scoped);
            proposalController?.abort(); const controller = new AbortController(); proposalController = controller; agentProgress = scoped.provider === 'external-agent' ? { id: scoped.requestId, message: '전송할 문서를 검증하고 있습니다.' } : undefined;
            const timer = setTimeout(() => controller.abort(), 60000);
            try {
              const before = await workspace.read(scoped); controller.signal.throwIfAborted();
              if (before.revision !== scoped.revision) throw new BoundaryError('CONFLICT', '저장본이 변경되었습니다. 기준을 다시 읽으세요.');
              if (scoped.provider === 'external-agent') {
                const review = await semanticWorker.analyze(workspace.analysisRoot(scoped), { requestId: scoped.requestId, workspaceId: scoped.workspaceId, workspaceEpoch: scoped.workspaceEpoch, relativePath: scoped.relativePath, before: scoped.text, after: scoped.text });
                if (!review.validation?.before) throw new BoundaryError('INVALID_REQUEST', '전송할 문서를 검증하지 못했습니다.');
                const current = await workspace.read(scoped);
                if (current.revision !== scoped.revision) throw new BoundaryError('CONFLICT', '검증 중 원본이 변경되었습니다. 기준을 다시 읽으세요.');
                value = await requestAgent(scoped, review.validation.before, controller.signal, message => { if (proposalController === controller) agentProgress = { id: scoped.requestId, message }; });
              } else value = await generateProposal(scoped, controller.signal);
              const after = await workspace.read(scoped); workspace.analysisRoot(scoped);
              if (controller.signal.aborted) throw new BoundaryError('CANCELLED', '제안 생성을 취소했습니다.');
              if (after.revision !== scoped.revision) throw new BoundaryError('CONFLICT', '생성 중 저장본이 변경되었습니다. 기준을 다시 읽으세요.');
            } finally { clearTimeout(timer); if (proposalController === controller) { proposalController = undefined; agentProgress = undefined; } }
            break;
          }
          case 'cancelAi': workspace.analysisRoot(request as ScopedRequest); aiController?.abort(); aiController = undefined; value = null; break;
          case 'queryAi': {
            const scoped = request as AiRequest; workspace.analysisRoot(scoped);
            if (!aiBundle || aiBundle.createdAt !== scoped.bundleId) throw new BoundaryError('INVALID_REQUEST', '검토한 맥락이 만료되었습니다. 다시 구성하세요.');
            aiController?.abort(); const controller = new AbortController(); aiController = controller;
            const timer = setTimeout(() => controller.abort(), 60000);
            try { value = await queryAi(aiBundle, scoped, controller.signal); workspace.analysisRoot(scoped); }
            finally { clearTimeout(timer); if (aiController === controller) aiController = undefined; }
            break;
          }
          case 'buildContext': {
            resetAi();
            const scoped = request as ContextRequest;
            value = await contextWorker.analyze(workspace.analysisRoot(scoped), scoped);
            workspace.analysisRoot(scoped); aiBundle = value as ContextBundle; break;
          }
          case 'cancelContext': resetAi(); workspace.analysisRoot(request as ScopedRequest); contextWorker.stop('맥락 구성을 취소했습니다.'); value = null; break;
          case 'workspaceRelations': {
            const scoped = request as ScopedRequest;
            value = await relationsWorker.analyze(workspace.analysisRoot(scoped), scoped);
            workspace.analysisRoot(scoped); break;
          }
          case 'cancelRelations': workspace.analysisRoot(request as ScopedRequest); relationsWorker.stop('관계 조사를 취소했습니다.'); value = null; break;
          case 'fileOperationStatus': workspace.analysisRoot(request as OperationRequest); value = fileChanges.status(request as OperationRequest); break;
          case 'cancelFileReview': workspace.analysisRoot(request as OperationRequest); value = fileChanges.cancel(request as OperationRequest); break;
          case 'previewFileChange':
          case 'applyFileChange':
            selecting = true;
            try { value = method === 'previewFileChange' ? await fileChanges.preview(request as FileChangeRequest) : await fileChanges.apply(request as FileChangeApply); } finally { fileChanges.finish(); selecting = false; }
            break;
          case 'copyDocument':
          case 'checkpointDocument':
            selecting = true;
            try { value = method === 'copyDocument' ? await workspace.copy(request as CopyRequest) : await workspace.checkpoint(request as AnalyzeRequest); } finally { selecting = false; }
            break;
          case 'listRecovery':
          case 'readRecovery': {
            const recoveryRequest = request as RecoveryRequest;
            const root = workspace.analysisRoot(recoveryRequest), recovery = new Recovery(recoveryRoot);
            value = method === 'listRecovery' ? await recovery.list(root) : await recovery.read(root, recoveryRequest.recoveryId, recoveryRequest.variant);
            workspace.analysisRoot(recoveryRequest); break;
          }
          case 'searchDocuments': {
            const searchRequest = request as SearchRequest;
            value = await searchWorker.analyze(workspace.analysisRoot(searchRequest), searchRequest);
            workspace.analysisRoot(searchRequest); break;
          }
          case 'cancelSearch': workspace.analysisRoot(request as ScopedRequest); searchWorker.stop('검색을 취소했습니다.'); value = null; break;
          case 'analyzeDocument': {
            const analysisRequest = request as AnalyzeRequest;
            const root = workspace.analysisRoot(analysisRequest);
            value = await preview.analyze(root, analysisRequest);
            workspace.analysisRoot(analysisRequest);
            break;
          }
          case 'confirmDiscard': value = discard(); break;
          case 'recoveryFolder':
            await fs.mkdir(recoveryRoot, { recursive: true });
            if (await shell.openPath(recoveryRoot)) throw new BoundaryError('INTERNAL_ERROR', '복구 폴더를 열지 못했습니다.');
            value = null; break;
          case 'saveDocument':
            selecting = true;
            try { value = await workspace.save(request as SaveRequest); } finally { selecting = false; }
            break;
          case 'createDocument':
            selecting = true;
            try { value = await workspace.createDocument(request as CreateDirectoryRequest); } finally { selecting = false; }
            break;
          case 'runtime': value = { protocolVersion, workerReady: preview.ready }; break;
          case 'recentWorkspaces': value = await recents.list(); break;
          case 'removeRecentWorkspace': await recents.remove((request as RecentRequest).recentId); value = null; break;
          case 'openRecentWorkspace': {
            selecting = true;
            try { value = await open(await recents.resolve((request as RecentRequest).recentId)); }
            finally { selecting = false; }
            break;
          }
          case 'openWorkspace':
          case 'createWorkspace': {
            selecting = true;
            try {
              const selection = await dialog.showOpenDialog(window, { title: method === 'createWorkspace' ? '새 작업 공간을 만들 상위 폴더 선택' : '작업 공간 열기', properties: ['openDirectory'] });
              if (selection.canceled || !selection.filePaths[0]) throw new BoundaryError('CANCELLED', '폴더 선택을 취소했습니다.');
              const root = method === 'createWorkspace' ? await createWorkspaceFolder(selection.filePaths[0], (request as NamedRequest).name) : selection.filePaths[0];
              value = await open(root);
            } finally { selecting = false; }
            break;
          }
          case 'closeWorkspace': resetAi(); value = workspace.close(request as ScopedRequest); semanticWorker.stop('작업 공간을 닫아 의미 비교를 취소했습니다.'); contextWorker.stop('작업 공간을 닫아 맥락 구성을 취소했습니다.'); currentRoot = undefined; currentSession = undefined; searchWorker.stop('작업 공간을 닫아 검색을 취소했습니다.'); relationsWorker.stop('작업 공간을 닫아 관계 조사를 취소했습니다.'); break;
          case 'createDirectory':
            selecting = true;
            try { value = await workspace.createDirectory(request as CreateDirectoryRequest); }
            finally { selecting = false; }
            break;
          case 'listDirectory': value = await workspace.list(request as PathRequest); break;
          case 'readDocument': value = await workspace.read(request as PathRequest); break;
        }
        return { ok: true, requestId, value };
      } catch (error) { return failure(requestId, fileError(error)); }
    });
  }
  void window.loadFile(entry);
});
app.on('window-all-closed', () => app.quit());
