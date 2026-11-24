import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { parse, stringify } from "yaml";

const editStatus = (page: Page) => page.getByText(/個のノートを編集中|編集はありません/);
const point = (page: Page) => page.getByRole("button", { name: "ピッチ点 2", exact: true });

async function openSelectedNote(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "デモ用サンプルを開く" }).click();
  await expect(page.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
  await page.getByRole("application").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__koebitTest !== undefined);
  const center = await page.evaluate(() => window.__koebitTest!.noteCenter(1));
  await page.mouse.click(center.x, center.y);
  await expect(point(page)).toBeVisible();
}

async function startDrag(page: Page) {
  const box = await point(page).boundingBox();
  if (!box) throw new Error("ピッチ点が表示されていません");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y - 24, { steps: 6 });
}

test("ドラッグは離した時に確定し、1回のUndoで戻してRedoできる", async ({ page }) => {
  await openSelectedNote(page);
  await startDrag(page);
  await expect(editStatus(page)).toHaveText("編集はありません");
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("編集はありません");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
});

test("ドラッグ中のEscは変更を破棄する", async ({ page }) => {
  await openSelectedNote(page);
  const before = await point(page).boundingBox();
  await startDrag(page);
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("編集はありません");
  const after = await point(page).boundingBox();
  expect(after?.x).toBeCloseTo(before!.x, 1);
  expect(after?.y).toBeCloseTo(before!.y, 1);
});

test("点をクリックするだけでは編集履歴を作らない", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).click();
  await expect(editStatus(page)).toHaveText("編集はありません");
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toBeDisabled();
});

test("ポインター操作の中断でドラッグを破棄する", async ({ page }) => {
  await openSelectedNote(page);
  await startDrag(page);
  await point(page).dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse" });
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("点の追加・削除と補間変更をUndoできる", async ({ page }) => {
  await openSelectedNote(page);
  const points = page.getByRole("button", { name: /^ピッチ点 \d+$/ });
  await expect(points).toHaveCount(2);
  await page.getByRole("button", { name: "ピッチ点を追加", exact: true }).click();
  await expect(points).toHaveCount(3);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(points).toHaveCount(2);
  await expect(editStatus(page)).toHaveText("編集はありません");

  await point(page).click();
  await page.getByRole("button", { name: "ピッチ点を削除", exact: true }).click();
  await expect(points).toHaveCount(1);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(points).toHaveCount(2);
  await expect(editStatus(page)).toHaveText("編集はありません");

  await page.getByRole("button", { name: "ピッチ点 1", exact: true }).click();
  await page.getByRole("combobox", { name: "ピッチ点の補間", exact: true }).selectOption("l");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("キーボードで点を動かして書き出し、USTXを再読込できる", async ({ page }) => {
  await openSelectedNote(page);
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  await length.fill("60");
  await length.press("Tab");
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "編集を反映して書き出す" }).click();
  const download = await downloadPromise;
  const path = await download.path();
  const bytes = await readFile(path);
  expect(bytes.equals(await readFile("public/samples/demo.ustx"))).toBe(false);
  const exported = parse(bytes.toString("utf8"));
  expect(exported.voice_parts[0].notes[1].vibrato.length).toBe(60);
  expect(exported.voice_parts[0].notes[1].pitch.data[1].y).toBeGreaterThan(0);
  // 新しいページで書き出した実ファイルを読み込み、構造エラーがないことを確かめる。
  const fresh = await page.context().newPage();
  await fresh.goto("/");
  await fresh.locator('input[type="file"]').setInputFiles({
    name: "edited.ustx",
    mimeType: "application/octet-stream",
    buffer: bytes,
  });
  await expect(fresh.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
  await expect(fresh.getByText("読み込めませんでした", { exact: true })).toBeHidden();
});

/* レビューで見つかった不具合の再発防止 */

const roll = (page: Page) => page.getByRole("application");
async function selectedCount(page: Page) {
  const label = (await roll(page).getAttribute("aria-label")) ?? "";
  return Number(/選択 (\d+) 個/.exec(label)?.[1]);
}
async function clickNote(page: Page, index: number) {
  const center = await page.evaluate((i) => window.__koebitTest!.noteCenter(i), index);
  await page.mouse.click(center.x, center.y);
}

test("点にフォーカスがあっても、Ctrl+Z で戻し Esc で選択を解除できる", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await page.keyboard.press("Control+z");
  await expect(editStatus(page)).toHaveText("編集はありません");
  await page.keyboard.press("Control+Shift+z");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await point(page).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => selectedCount(page)).toBe(0);
  await expect(point(page)).toBeHidden();
});

test("ビブラートの入力は、確定前に別のノートを選んでも失われない", async ({ page }) => {
  await openSelectedNote(page);
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  await length.fill("60");
  await clickNote(page, 2);
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await clickNote(page, 1);
  await expect(length).toHaveValue("60");
});

test("ドラッグ中に選択が変わってもドラッグ状態を残さず、Esc で選択を解除できる", async ({
  page,
}) => {
  await openSelectedNote(page);
  await startDrag(page);
  await page.keyboard.press("Control+a");
  await expect.poll(() => selectedCount(page)).toBe(12);
  await page.mouse.up();
  // 点のボタンが消えてフォーカスが外れるため、ピアノロールに戻してから Esc を押す
  await roll(page).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => selectedCount(page)).toBe(0);
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("ノートを選び直すと、選んでいる点は先頭の点に戻る", async ({ page }) => {
  await openSelectedNote(page);
  await page.getByRole("button", { name: "ピッチ点を追加", exact: true }).click();
  await expect(page.getByRole("button", { name: "ピッチ点 3", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await clickNote(page, 2);
  await expect(page.getByRole("button", { name: "ピッチ点 1", exact: true })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("自動接続中は最後の1点を削除できず、自動接続も保たれる", async ({ page }) => {
  await openSelectedNote(page);
  const remove = page.getByRole("button", { name: "ピッチ点を削除", exact: true });
  await remove.click();
  await expect(page.getByRole("button", { name: /^ピッチ点 \d+$/ })).toHaveCount(1);
  await expect(remove).toBeDisabled();
  await expect(page.getByText(/最後の 1 点を削除できません/)).toBeVisible();
  await expect(page.getByRole("checkbox", { name: "先頭点を前のノートに接続" })).toBeChecked();
});

test("フェードインとフェードアウトは、後から入力した方を優先する", async ({ page }) => {
  await openSelectedNote(page);
  const fadeIn = page.getByRole("spinbutton", { name: "ビブラート フェードイン (%)", exact: true });
  const fadeOut = page.getByRole("spinbutton", {
    name: "ビブラート フェードアウト (%)",
    exact: true,
  });
  await fadeOut.fill("50");
  await fadeOut.press("Enter");
  await fadeIn.fill("80");
  await fadeIn.press("Enter");
  await expect(fadeIn).toHaveValue("80");
  await expect(fadeOut).toHaveValue("20");
});

test("時間順に並んでいないピッチ点も、同じ点を続けて編集できる", async ({ page }) => {
  const project = parse(await readFile("public/samples/demo.ustx", "utf8"));
  // 2 番目のノートの点を、時間の逆順（x = 25, -25）で保存したファイルを作る
  project.voice_parts[0].notes[1].pitch.data = [
    { x: 25, y: 0, shape: "io" },
    { x: -25, y: 0, shape: "io" },
  ];
  await page.goto("/");
  await page.locator('input[type="file"]').setInputFiles({
    name: "unsorted.ustx",
    mimeType: "application/octet-stream",
    buffer: Buffer.from(stringify(project)),
  });
  await expect(page.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
  await page.getByRole("application").scrollIntoViewIfNeeded();
  await page.waitForFunction(() => window.__koebitTest !== undefined);
  await clickNote(page, 1);
  await expect(page.getByText("ピッチ点が時間順に並んでいません")).toBeVisible();
  // 曲線と同じく、保存順の先頭（x = 25、番号では 2）を前のノートに接続して表示する。
  // 前のノートは 3 半音低いため、点 2 は点 1 より下に描かれる
  const first = (await page
    .getByRole("button", { name: "ピッチ点 1", exact: true })
    .boundingBox())!;
  const second = (await point(page).boundingBox())!;
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.y).toBeGreaterThan(first.y + 10);
  // 「ピッチ点 2」は時間順で 2 番目（x = 25）の点。2 回続けて上げても同じ点を動かす
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "編集を反映して書き出す" }).click();
  const exported = parse(await readFile(await (await downloadPromise).path(), "utf8"));
  expect(exported.voice_parts[0].notes[1].pitch.data).toEqual([
    { x: -25, y: 0, shape: "io" },
    { x: 25, y: 2, shape: "io" },
  ]);
});

test("ドラッグを始めても、点はカーソルの位置へ飛ばず、動かした分だけ動く", async ({ page }) => {
  await openSelectedNote(page);
  const before = (await point(page).boundingBox())!;
  const cx = before.x + before.width / 2;
  const cy = before.y + before.height / 2;
  // 点の中心から右下へ 5px ずれた所を押して、真上へ 24px 動かす
  await page.mouse.move(cx + 5, cy + 5);
  await page.mouse.down();
  await page.mouse.move(cx + 5, cy + 5 - 24, { steps: 6 });
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  const after = (await point(page).boundingBox())!;
  // 音高は 10 cent 単位に丸めるため、縦は数 px の誤差を許す
  expect(Math.abs(after.x + after.width / 2 - cx)).toBeLessThan(2);
  expect(Math.abs(after.y + after.height / 2 - (cy - 24))).toBeLessThan(4);
});

test("確定前のビブラート入力があっても、「やり直す」はやり直しの履歴どおりに動く", async ({
  page,
}) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("編集はありません");
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  const original = await length.inputValue();
  await length.fill("60");
  await page.getByRole("button", { name: "やり直す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await expect(length).toHaveValue(original);
  await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeDisabled();
});

test("ボタンにフォーカスが移らないブラウザでも、確定前の入力でやり直しの履歴を消さない", async ({
  page,
}) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  const original = await length.inputValue();
  await length.fill("60");
  // Safari のクリック：pointerdown の後、フォーカスの移動先が無いまま入力欄の blur が起きる
  const redo = page.getByRole("button", { name: "やり直す", exact: true });
  await redo.dispatchEvent("pointerdown", { bubbles: true });
  await length.evaluate((el) => (el as HTMLInputElement).blur());
  await redo.click();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await expect(length).toHaveValue(original);
  await expect(redo).toBeDisabled();
});

test("Enter・Space では点を動かさずに選べる", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("Enter");
  await expect(point(page)).toHaveAttribute("aria-pressed", "true");
  const first = page.getByRole("button", { name: "ピッチ点 1", exact: true });
  await first.focus();
  await page.keyboard.press("Space");
  await expect(first).toHaveAttribute("aria-pressed", "true");
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("Delete で点を消すと、前の点にフォーカスが移り、続けて操作できる", async ({ page }) => {
  await openSelectedNote(page);
  await page.getByRole("button", { name: "ピッチ点を追加", exact: true }).click();
  await page.getByRole("button", { name: "ピッチ点 3", exact: true }).focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: /^ピッチ点 \d+$/ })).toHaveCount(2);
  await expect(point(page)).toBeFocused();
  await page.keyboard.press("ArrowUp");
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toHaveAttribute(
    "title",
    /ピッチ点を移動/,
  );
});

test("「ピッチカーブを表示」をオフにすると、ピッチ点も隠して案内を出す", async ({ page }) => {
  await openSelectedNote(page);
  await page.getByRole("checkbox", { name: "ピッチカーブを表示" }).uncheck();
  await expect(point(page)).toBeHidden();
  await expect(page.getByText(/「ピッチカーブを表示」をオンにすると/)).toBeVisible();
  await page.getByRole("checkbox", { name: "ピッチカーブを表示" }).check();
  await expect(point(page)).toBeVisible();
});

test("ノートを 1 つだけ選んでいないときは、選び方を案内する", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("button", { name: "デモ用サンプルを開く" }).click();
  await expect(page.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
  const panel = page.getByRole("region", { name: "手動ピッチ編集" });
  await expect(panel).toContainText("ノートを 1 つだけ選ぶと");
  await roll(page).focus();
  await page.keyboard.press("Control+a");
  await expect(panel).toContainText("（今は 12 個選んでいます）");
});
