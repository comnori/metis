// Open commands through the shared palette so tests follow the public entry point.
export async function uiCommand(page, label) {
  const button = page.getByRole('button', { name: '명령 팔레트', exact: true });
  if (await button.isVisible() && !await button.evaluate(e => !!e.closest('[inert]'))) await button.click();
  else await page.keyboard.press('ControlOrMeta+Shift+P');
  const palette = page.getByRole('dialog', { name: '명령 팔레트' });
  await palette.getByRole('combobox').fill(label);
  await palette.getByRole('combobox').press('Enter');
}
