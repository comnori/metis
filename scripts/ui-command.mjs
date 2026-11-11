// Open commands through the shared palette so tests follow the public entry point.
export async function uiCommand(page, label) {
  // Startup restoration temporarily disables and inerts the sidebar. Wait for
  // the command entry point before choosing the visible button or its shortcut.
  const button = page.locator('button[aria-label="명령 팔레트"]');
  await page.waitForFunction(() => {
    const button = document.querySelector('button[aria-label="명령 팔레트"]');
    return button && !button.disabled;
  });
  if (await button.isVisible() && !await button.evaluate(e => !!e.closest('[inert]'))) await button.click();
  else await page.keyboard.press('ControlOrMeta+Shift+P');
  const palette = page.getByRole('dialog', { name: '명령 팔레트' });
  await palette.getByRole('combobox').fill(label);
  await palette.getByRole('combobox').press('Enter');
}
