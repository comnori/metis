// Open commands through the shared palette so tests follow the public entry point.
export async function uiCommand(page, label) {
  await page.getByRole('button', { name: '명령 팔레트', exact: true }).click();
  const palette = page.getByRole('dialog', { name: '명령 팔레트' });
  await palette.getByRole('combobox').fill(label);
  await palette.getByRole('combobox').press('Enter');
}
