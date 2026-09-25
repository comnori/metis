# PRE-03 검증 코드

제품 앱과 분리한 웹뷰 스택 검증용 코드다. 결과와 미검증 범위는 [검증 기록](../../docs/pre-03-validation.md)을 따른다. `core.cjs`의 저장과 경로 처리를 검토 없이 제품으로 복사하지 않는다.

## 실행

저장소 루트에서 PRE-02의 규모 자료를 준비한다. 해당 폴더가 이미 있으면 다시 생성할 필요가 없다. 생성 도구는 기존 폴더를 덮어쓰지 않는다.

```text
python tools/pre02.py scale --size small --dest .pre02-runs/audit-small
python tools/pre02.py scale --size medium --dest .pre02-runs/audit-medium
python tools/pre02.py scale --size large --dest .pre02-runs/audit-large
```

검증 폴더에서 기록된 Node 버전과 npm을 사용한다. 의존성을 임의 최신화하지 않고 lockfile로 설치한다.

```text
cd experiments/pre03
npm ci
npm run typecheck
npm run build
npm test -- --reporter=json --outputFile=../../docs/pre-03/core-results.json
npm run probe:desktop
npm run package
node benchmark.mjs
node windows-files.cjs
node cancellation-test.mjs
```

Windows 패키지 실행 검증:

```powershell
$env:PRE03_PACKAGED = (Resolve-Path -LiteralPath 'out/metis-pre03-probe-win32-x64/metis-pre03-probe.exe').Path
node desktop-test.mjs
Remove-Item Env:PRE03_PACKAGED
```

`desktop-test.mjs`는 자식 프로세스 환경에서 `ELECTRON_RUN_AS_NODE`를 제거한다. 검증 창은 숨겨진 상태로 실행하며 종료 시 검증 프로세스만 닫는다. Windows 잠금 검사도 새 실험 복사본에만 적용하고 핸들·읽기 전용 속성을 복원한다.

실행 기록은 `docs/pre-03`의 같은 이름 파일을 갱신하므로 기존 결과를 보존하려면 먼저 별도 기록 위치로 복사한다. `environment.json`의 지문은 기록 당시 소스를 식별하며 소스 수정 후의 실행 결과와 혼용하지 않는다.

## 책임 구분

| 파일 | 역할 |
| --- | --- |
| `core.test.mjs`, `core.cjs` | 신뢰된 fixture 해석, 원본 인코딩·충돌, 경로 경계, 메모리 FTS |
| `renderer.tsx` | React·CodeMirror·미리보기 검사 대상 |
| `electron/main.cjs`, `preload.cjs`, `worker.cjs` | 창·IPC·문서 변환·SQLite 실행 |
| `desktop-test.mjs` | 개발·패키지 실행의 Playwright 검사 |
| `windows-files.cjs`, `lock-file.ps1` | Windows 파일 상태 실험 |
| `cancellation-test.mjs`, `electron/stress.cjs` | 합성 CPU 작업의 응답성·중단 실험 |
| `benchmark.mjs` | PRE-02 자료의 단일 프로세스 측정 |

Asciidoctor `unsafe` 테스트는 저장소에서 검토한 PRE-02 자료에만 사용한다. 사용자 문서·외부 파일을 해당 테스트 경로에 넣지 않는다. Electron 프로브는 문서 포함을 허용하는 제품용 로더를 구현하지 않았다. CodeMirror 자동완성은 고정된 샘플 후보이며 완전한 AsciiDoc 언어 지원이 아니다.
