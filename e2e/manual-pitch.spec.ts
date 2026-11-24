import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";
import { parse } from "yaml";

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
