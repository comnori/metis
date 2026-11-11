// Open commands through the shared palette so tests follow the public entry point.
export async function uiCommand(page, label) {
  // Startup restoration temporarily disables the command entry point. Its
  // shortcut also works while the narrow-screen sidebar is animating closed.
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="명령 팔레트"]');
    return button && !button.disabled;
  });
  // Preview frames isolate keyboard events; return focus to the app first.
  await page.getByRole('main', { name: '문서 작업 영역' }).focus();
  // Keep the named invoker for focus restoration. A hidden/inert sidebar
  // cannot take focus, so narrow layouts retain the main-area fallback.
  await page.locator('button[aria-label="명령 팔레트"]').focus();
  await page.keyboard.press('ControlOrMeta+Shift+P');
  const palette = page.getByRole('dialog', { name: '명령 팔레트' });
  await palette.getByRole('combobox').fill(label);
  await palette.getByRole('combobox').press('Enter');
}
