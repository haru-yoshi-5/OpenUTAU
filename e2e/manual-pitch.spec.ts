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
  // 点のボタンが消えても、フォーカスはピアノロールに残る
  await expect(roll(page)).toBeFocused();
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
  // 点のボタンが消えても、フォーカスはピアノロールに移っているので、そのまま Esc を押せる
  await expect(roll(page)).toBeFocused();
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

/** 2 番目のノートの点を、時間の逆順（x = 25, -25）で保存したファイルを開いて、そのノートを選ぶ */
async function openUnsortedNote(page: Page) {
  const project = parse(await readFile("public/samples/demo.ustx", "utf8"));
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
}

async function exportedPitch(page: Page) {
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "編集を反映して書き出す" }).click();
  const exported = parse(await readFile(await (await downloadPromise).path(), "utf8"));
  return exported.voice_parts[0].notes[1].pitch;
}

test("時間順に並んでいない点は、曲線と同じく保存順の先頭を接続して表示する", async ({ page }) => {
  await openUnsortedNote(page);
  // 保存順の先頭（x = 25、番号では 2）を前のノートに接続する。前のノートは 3 半音低いため、点 2 は点 1 より下
  const first = (await page
    .getByRole("button", { name: "ピッチ点 1", exact: true })
    .boundingBox())!;
  const second = (await point(page).boundingBox())!;
  expect(second.x).toBeGreaterThan(first.x);
  expect(second.y).toBeGreaterThan(first.y + 10);
});

test("時間順に並んでいないノートは、並べ替えるまで点を編集できない", async ({ page }) => {
  await openUnsortedNote(page);
  await expect(point(page)).toBeDisabled();
  await expect(page.getByRole("button", { name: "ピッチ点を追加", exact: true })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "先頭点を前のノートに接続" })).toBeDisabled();
  await page.getByRole("button", { name: "時間順に並べ替える", exact: true }).click();
  // 並べ替えは 1 つの編集として記録され、書き出しにも反映される
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await expect(page.getByText("ピッチ点が時間順に並んでいません")).toBeHidden();
  await expect(point(page)).toBeEnabled();
  expect((await exportedPitch(page)).data).toEqual([
    { x: -25, y: 0, shape: "io" },
    { x: 25, y: 0, shape: "io" },
  ]);
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(page.getByText("ピッチ点が時間順に並んでいません")).toBeVisible();
  await expect(point(page)).toBeDisabled();
});

test("並べ替えた後に自動接続を外すと、接続していた先頭の点の高さを残す", async ({ page }) => {
  await openUnsortedNote(page);
  await page.getByRole("button", { name: "時間順に並べ替える", exact: true }).click();
  await page.getByRole("checkbox", { name: "先頭点を前のノートに接続" }).uncheck();
  const pitch = await exportedPitch(page);
  expect(pitch.snap_first).toBe(false);
  // 前のノートとの音高差（-3 半音 = -30）が、先頭（x = -25）の点に入る
  expect(pitch.data).toEqual([
    { x: -25, y: -30, shape: "io" },
    { x: 25, y: 0, shape: "io" },
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

test("押せない「やり直す」を押しても、確定前の入力は消えずに確定する", async ({ page }) => {
  await openSelectedNote(page);
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  await length.fill("60");
  const redo = page.getByRole("button", { name: "やり直す", exact: true });
  await expect(redo).toBeDisabled();
  const box = (await redo.boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await expect(length).toHaveValue("60");
});

test("「元に戻す」を押したまま外へずらしてやめると、確定前の入力は確定する", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  await length.fill("60");
  const undo = page.getByRole("button", { name: "元に戻す", exact: true });
  const box = (await undo.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height + 80, { steps: 4 });
  await page.mouse.up();
  await expect(length).toHaveValue("60");
  await expect(undo).toHaveAttribute("title", /ビブラートを変更/);
});

test("点をクリックした後も、Space を押しながらのドラッグで表示を移動できる", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).click();
  const before = await page.evaluate(() => window.__koebitTest!.noteCenter(0));
  await page.keyboard.down(" ");
  await page.mouse.move(before.x + 200, before.y + 60);
  await page.mouse.down();
  await page.mouse.move(before.x + 200, before.y - 60, { steps: 6 });
  await page.mouse.up();
  await page.keyboard.up(" ");
  const after = await page.evaluate(() => window.__koebitTest!.noteCenter(0));
  expect(after.y).toBeLessThan(before.y - 100);
  // 選択は変わらず、編集中のノートの点が表示されたまま
  await expect.poll(() => selectedCount(page)).toBe(1);
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("矢印キーは横 5 ms・縦 10 cent、Shift で 10 倍動かす", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("Shift+ArrowUp");
  await page.keyboard.press("Shift+ArrowRight");
  // デモの 2 番目のノートの点 2 は x = 25, y = 0
  expect((await exportedPitch(page)).data[1]).toEqual({ x: 80, y: 10, shape: "io" });
});

test("矢印キーの長押しは、1 回の「元に戻す」でまとめて戻せる", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.down("ArrowUp");
  await page.keyboard.up("ArrowUp");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("編集はありません");
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toBeDisabled();
});

test("ドラッグ中に矢印キーを押しても、確定前の位置を記録しない", async ({ page }) => {
  await openSelectedNote(page);
  await startDrag(page);
  await page.keyboard.press("ArrowUp");
  await expect(editStatus(page)).toHaveText("編集はありません");
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("矢印キーの長押しは、元に戻した後に古い操作とつながらない", async ({ page }) => {
  await openSelectedNote(page);
  // 操作 A：ドラッグで動かす
  await startDrag(page);
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  // 操作 B：長押しで動かし、押したまま元に戻す
  await page.getByRole("button", { name: "ピッチ点 1", exact: true }).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.down("ArrowRight");
  await page.keyboard.press("Control+z");
  // 押し続けた続きのキーリピートは、A とまとめず別の操作 C になる
  await page.keyboard.down("ArrowRight");
  await page.keyboard.up("ArrowRight");
  const undo = page.getByRole("button", { name: "元に戻す", exact: true });
  await undo.click();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await undo.click();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("ドラッグ中に点の表示を消しても、確定前のプレビューを残さない", async ({ page }) => {
  await openSelectedNote(page);
  const before = (await point(page).boundingBox())!;
  await startDrag(page);
  const toggle = page.getByRole("checkbox", { name: "ピッチカーブを表示" });
  await toggle.evaluate((el) => (el as HTMLInputElement).click());
  await page.mouse.up();
  await toggle.evaluate((el) => (el as HTMLInputElement).click());
  await expect(point(page)).toBeVisible();
  await expect(editStatus(page)).toHaveText("編集はありません");
  const after = (await point(page).boundingBox())!;
  expect(after.y).toBeCloseTo(before.y, 1);
});

test("時間順に並んでいないノートの点は、ドラッグしても編集にならない", async ({ page }) => {
  await openUnsortedNote(page);
  const box = (await point(page).boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 12, y - 24, { steps: 6 });
  await page.mouse.up();
  await expect(editStatus(page)).toHaveText("編集はありません");
  await expect(page.getByText("ピッチ点が時間順に並んでいません")).toBeVisible();
});

test("Delete を長押ししても、消えるのは 1 点だけ", async ({ page }) => {
  await openSelectedNote(page);
  await page.getByRole("button", { name: "ピッチ点を追加", exact: true }).click();
  await page.getByRole("button", { name: "ピッチ点 3", exact: true }).focus();
  for (let i = 0; i < 4; i++) await page.keyboard.down("Delete");
  await page.keyboard.up("Delete");
  await expect(page.getByRole("button", { name: /^ピッチ点 \d+$/ })).toHaveCount(2);
});

test("確定前のビブラート入力があるときにページを閉じようとすると、ブラウザの確認が出る", async ({
  page,
}) => {
  await openSelectedNote(page);
  await expect(editStatus(page)).toHaveText("編集はありません");
  await page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true }).fill("60");
  const dialogPromise = page.waitForEvent("dialog");
  void page.close({ runBeforeUnload: true });
  const dialog = await dialogPromise;
  expect(dialog.type()).toBe("beforeunload");
  await dialog.dismiss();
});

test("確定前のビブラート入力があるときの「元に戻す」は、入力だけを取り消す", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  const original = await length.inputValue();
  await length.fill("60");
  const undo = page.getByRole("button", { name: "元に戻す", exact: true });
  await undo.click();
  // 記録済みの点の移動は残り、入力だけが元の値に戻る
  await expect(length).toHaveValue(original);
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await expect(undo).toHaveAttribute("title", /ピッチ点を移動/);
  await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeDisabled();
  // もう一度押すと、記録済みの編集を戻す
  await undo.click();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("ビブラートに数値以外を入れて確定すると、元の値に戻して理由を表示する", async ({ page }) => {
  await openSelectedNote(page);
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  const original = await length.inputValue();
  await length.fill("");
  await length.press("Tab");
  await expect(length).toHaveValue(original);
  await expect(page.getByRole("alert").filter({ hasText: "数値を入力してください" })).toBeVisible();
  await expect(length).toHaveAttribute("aria-invalid", "true");
  await expect(editStatus(page)).toHaveText("編集はありません");
  // 入力し直すと表示は消える
  await length.fill("60");
  await expect(page.getByText("数値を入力してください")).toBeHidden();
});

test("表示範囲の外へスクロールした点には、Tab で移れない", async ({ page }) => {
  await openSelectedNote(page);
  await expect(point(page)).not.toHaveAttribute("tabindex", "-1");
  const box = (await roll(page).boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  // 縦にスクロールして、選んでいるノートの点を描画範囲の外へ出す
  const before = (await point(page).boundingBox())!;
  for (const dy of [-3000, 3000]) {
    await page.mouse.wheel(0, dy);
    const after = await point(page).boundingBox();
    if (after && (after.y + after.height < box.y || after.y > box.y + box.height)) break;
  }
  expect((await point(page).boundingBox())!.y).not.toBe(before.y);
  await expect(point(page)).toHaveAttribute("tabindex", "-1");
});

/** タッチのタップ：pointerup の後、別のタスクでクリックが届く */
async function delayedTap(page: Page, name: string) {
  const button = page.getByRole("button", { name, exact: true });
  await button.scrollIntoViewIfNeeded();
  const box = (await button.boundingBox())!;
  const init = { bubbles: true, clientX: box.x + box.width / 2, clientY: box.y + box.height / 2 };
  await button.dispatchEvent("pointerdown", { ...init, pointerType: "touch" });
  await button.dispatchEvent("pointerup", { ...init, pointerType: "touch" });
  await page.waitForTimeout(150);
  await button.evaluate((el) => (el as HTMLButtonElement).click());
}

test("タッチで「やり直す」をタップしても、確定前の入力でやり直しの履歴を消さない", async ({
  page,
}) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  const original = await length.inputValue();
  await length.fill("60");
  await delayedTap(page, "やり直す");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await expect(length).toHaveValue(original);
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toHaveAttribute(
    "title",
    /ピッチ点を移動/,
  );
});

test("タッチで「元に戻す」をタップすると、確定前の入力だけを取り消す", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowUp");
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  const original = await length.inputValue();
  await length.fill("60");
  await delayedTap(page, "元に戻す");
  await expect(length).toHaveValue(original);
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toHaveAttribute(
    "title",
    /ピッチ点を移動/,
  );
  await expect(page.getByRole("button", { name: "やり直す", exact: true })).toBeDisabled();
});

test("Delete で点を消した後、表示範囲の外の点にはフォーカスを移さない", async ({ page }) => {
  await openSelectedNote(page);
  await page.getByRole("button", { name: "ピッチ点を追加", exact: true }).click();
  // 先頭の点を表示範囲の外（左）へ出す
  const first = page.getByRole("button", { name: "ピッチ点 1", exact: true });
  await first.focus();
  const rollBox = (await roll(page).boundingBox())!;
  for (let i = 0; i < 200; i++) {
    const box = (await first.boundingBox())!;
    if (box.x + box.width < rollBox.x) break;
    await page.keyboard.press("Shift+ArrowLeft");
  }
  await expect(first).toHaveAttribute("tabindex", "-1");
  await point(page).focus();
  await page.keyboard.press("Delete");
  await expect(page.getByRole("button", { name: /^ピッチ点 \d+$/ })).toHaveCount(2);
  await expect(first).not.toBeFocused();
  await expect(roll(page)).toBeFocused();
});

test("「ピッチカーブを表示」がオフの間は、パネルからもピッチ点を編集できない", async ({ page }) => {
  await openSelectedNote(page);
  await page.getByRole("checkbox", { name: "ピッチカーブを表示" }).uncheck();
  await expect(page.getByRole("button", { name: "ピッチ点を追加", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "ピッチ点を削除", exact: true })).toBeDisabled();
  await expect(page.getByRole("combobox", { name: "ピッチ点の補間" })).toBeDisabled();
  await expect(page.getByRole("checkbox", { name: "先頭点を前のノートに接続" })).toBeDisabled();
  // ビブラートは曲線の表示と関係なく編集できる
  await expect(
    page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true }),
  ).toBeEnabled();
});

test("長押しのまま別の点へフォーカスを移すと、前の長押しとは別の操作になる", async ({ page }) => {
  await openSelectedNote(page);
  const first = page.getByRole("button", { name: "ピッチ点 1", exact: true });
  await first.focus();
  await page.keyboard.press("ArrowLeft");
  // 先頭の点は自動接続中で高さを変えないため、横に動かす
  // 押したまま点 2 へ移った状態：点 2 にはキーリピートだけが届く
  await point(page).focus();
  await point(page).evaluate((el) =>
    el.dispatchEvent(
      new KeyboardEvent("keydown", { key: "ArrowLeft", repeat: true, bubbles: true }),
    ),
  );
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  // 点 2 の移動だけが戻り、点 1 の移動は残る
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");
  await page.getByRole("button", { name: "元に戻す", exact: true }).click();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("パネルのチェックボックスで Space を押しても、表示移動モードにならない", async ({ page }) => {
  await openSelectedNote(page);
  const snap = page.getByRole("checkbox", { name: "先頭点を前のノートに接続" });
  const checked = await snap.isChecked();
  await snap.focus();
  await page.keyboard.down(" ");
  // 表示移動モードの間は、点がポインター操作を受け付けない
  await expect(point(page)).toHaveCSS("pointer-events", "auto");
  await page.keyboard.up(" ");
  // Space はチェックボックスの切り替えに使われる
  await expect(snap).toBeChecked({ checked: !checked });
});

test("「元に戻す」を右クリックしても、確定前の入力はすぐに確定する", async ({ page }) => {
  await openSelectedNote(page);
  await point(page).focus();
  await page.keyboard.press("ArrowLeft");
  const length = page.getByRole("spinbutton", { name: "ビブラート 長さ (%)", exact: true });
  await length.fill("60");
  const undo = page.getByRole("button", { name: "元に戻す", exact: true });
  await undo.scrollIntoViewIfNeeded();
  const box = (await undo.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down({ button: "right" });
  // 右クリックでは「元に戻す」は実行されないので、待たずに確定する（クリックを待つ 1 秒より短い時間で確かめる）
  await expect(undo).toHaveAttribute("title", /ビブラートを変更/, { timeout: 500 });
  await page.mouse.up({ button: "right" });
  await expect(length).toHaveValue("60");
});

test("追加した点のドラッグ中に Ctrl+Z で点が消えても、その後の編集を受け付ける", async ({
  page,
}) => {
  await openSelectedNote(page);
  await page.getByRole("button", { name: "ピッチ点を追加", exact: true }).click();
  const added = page.getByRole("button", { name: "ピッチ点 3", exact: true });
  const box = (await added.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 10, box.y - 20, { steps: 4 });
  await page.keyboard.press("Control+z");
  await expect(added).toBeHidden();
  await page.mouse.up();
  await point(page).focus();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("button", { name: "元に戻す", exact: true })).toHaveAttribute(
    "title",
    /ピッチ点を移動/,
  );
});

test("ドラッグ中にスクロールしても、プレビューの点はポインターの下に残る", async ({ page }) => {
  await openSelectedNote(page);
  await startDrag(page);
  const before = (await point(page).boundingBox())!;
  const pointerY = before.y + before.height / 2;
  await page.mouse.wheel(0, 200);
  // スクロールした分だけ点が流されず、ポインターの位置で計算し直される
  await expect
    .poll(async () => {
      const b = (await point(page).boundingBox())!;
      return Math.abs(b.y + b.height / 2 - pointerY);
    })
    .toBeLessThan(6);
  await page.mouse.up();
});

test("ピアノロールの外の role で作った部品で Space を押しても、表示移動モードにならない", async ({
  page,
}) => {
  await openSelectedNote(page);
  await page.evaluate(() => {
    const el = document.createElement("div");
    el.setAttribute("role", "switch");
    el.setAttribute("aria-label", "テスト用スイッチ");
    el.tabIndex = 0;
    document.body.append(el);
  });
  await page.getByRole("switch", { name: "テスト用スイッチ" }).focus();
  await page.keyboard.down(" ");
  await expect(point(page)).toHaveCSS("pointer-events", "auto");
  await page.keyboard.up(" ");
});
