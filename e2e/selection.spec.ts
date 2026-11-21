import { expect, type Page, test } from "@playwright/test";

/*
 * ピアノロールでの範囲選択（Phase 2-2）を、実際のブラウザで確かめる。
 * デモ用サンプルの A メロ（12 ノート、4 小節）を使う。座標は開発ビルドのテスト用の入口から得る。
 */

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "デモ用サンプルを開く" }).click();
  await expect(page.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
  await page.waitForFunction(() => window.__koebitTest !== undefined);
  await page.getByRole("application").scrollIntoViewIfNeeded();
}

const roll = (page: Page) => page.getByRole("application");

/** ピアノロールのラベル（「…、選択 N 個」）から選択数を読む */
async function selectedCount(page: Page) {
  const label = (await roll(page).getAttribute("aria-label")) ?? "";
  return Number(/選択 (\d+) 個/.exec(label)?.[1]);
}

const noteCenter = (page: Page, index: number) =>
  page.evaluate((i) => window.__koebitTest!.noteCenter(i), index);
const rulerPoint = (page: Page, tick: number) =>
  page.evaluate((t) => window.__koebitTest!.rulerPoint(t), tick);

test("クリックで選び、Shift で追加し、何もない所のクリックで解除する", async ({ page }) => {
  await openSample(page);
  const first = await noteCenter(page, 1);
  const second = await noteCenter(page, 2);

  await page.mouse.click(first.x, first.y);
  await expect.poll(() => selectedCount(page)).toBe(1);

  await page.keyboard.down("Shift");
  await page.mouse.click(second.x, second.y);
  await page.keyboard.up("Shift");
  await expect.poll(() => selectedCount(page)).toBe(2);

  // ノートの下の、何もない行をクリックする
  await page.mouse.click(first.x, first.y + 120);
  await expect.poll(() => selectedCount(page)).toBe(0);
});

test("何もない所からドラッグすると、囲んだノートを選ぶ", async ({ page }) => {
  await openSample(page);
  const a = await noteCenter(page, 3);
  const b = await noteCenter(page, 5);
  // 3〜5 番目のノートを囲む（左下の何もない所から右上へ）
  await page.mouse.move(a.x - 2, Math.max(a.y, b.y) + 60);
  await page.mouse.down();
  await page.mouse.move(b.x + 2, Math.min(a.y, b.y) - 10, { steps: 8 });
  await page.mouse.up();
  await expect.poll(() => selectedCount(page)).toBe(3);

  // ノート一覧の見出しと選択が一致する
  await expect(page.getByText(/^ノート一覧/)).toContainText("選択 3 件");
});

test("小節ルーラーのドラッグで、小節単位の範囲を選ぶ", async ({ page }) => {
  await openSample(page);
  // 2 小節目（1920 tick〜）から 3 小節目（3840 tick〜）までドラッグする
  const start = await rulerPoint(page, 1920 + 100);
  const end = await rulerPoint(page, 3840 + 100);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(end.x, end.y, { steps: 6 });
  await page.mouse.up();
  // 1920〜5760 tick に掛かるノート（「か」「ぶ」「ひ」「か」「り」「と」「お」）
  await expect.poll(() => selectedCount(page)).toBe(7);
});

test("Ctrl+A ですべて選び、Esc で解除する", async ({ page }) => {
  await openSample(page);
  await roll(page).focus();
  await page.keyboard.press("Control+a");
  await expect.poll(() => selectedCount(page)).toBe(12);
  await page.keyboard.press("Escape");
  await expect.poll(() => selectedCount(page)).toBe(0);
});

test("ノート一覧のチェックでも選べ、ピアノロールと一致する", async ({ page }) => {
  await openSample(page);
  await page.getByText(/^ノート一覧/).click();
  await page.getByRole("checkbox", { name: "3 番目のノート「に」を選択" }).check();
  await page.getByRole("checkbox", { name: "5 番目のノート「か」を選択" }).check();
  await expect.poll(() => selectedCount(page)).toBe(2);

  // 一覧を開くとページがスクロールするため、ピアノロールを画面内に戻してから座標を取る
  await roll(page).scrollIntoViewIfNeeded();
  const center = await noteCenter(page, 4);
  await page.mouse.click(center.x, center.y);
  await expect(page.getByRole("checkbox", { name: "5 番目のノート「か」を選択" })).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "3 番目のノート「に」を選択" }),
  ).not.toBeChecked();
});

// デモは 4 小節で画面の幅に収まり横にはスクロールしないため、表示の移動は縦（音高の方向）で確かめる
test.describe("表示の移動は選択とぶつからない", () => {
  test("Space を押しながらのドラッグで移動し、選択は変わらない", async ({ page }) => {
    await openSample(page);
    await roll(page).focus();
    const before = await noteCenter(page, 0);
    await page.keyboard.down(" ");
    await page.mouse.move(before.x + 200, before.y + 60);
    await page.mouse.down();
    await page.mouse.move(before.x + 200, before.y - 60, { steps: 6 });
    await page.mouse.up();
    await page.keyboard.up(" ");
    const after = await noteCenter(page, 0);
    expect(after.y).toBeLessThan(before.y - 100);
    expect(await selectedCount(page)).toBe(0);
  });

  test("中ボタンのドラッグで移動する", async ({ page }) => {
    await openSample(page);
    const before = await noteCenter(page, 0);
    await page.mouse.move(before.x + 200, before.y + 60);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(before.x + 200, before.y - 60, { steps: 6 });
    await page.mouse.up({ button: "middle" });
    const after = await noteCenter(page, 0);
    expect(after.y).toBeLessThan(before.y - 100);
    expect(await selectedCount(page)).toBe(0);
  });
});

test.describe("タッチ操作", () => {
  test.use({ hasTouch: true });

  test("タップでノートを選び、1 本指のドラッグで移動する", async ({ page }) => {
    await openSample(page);
    const note = await noteCenter(page, 2);
    await page.touchscreen.tap(note.x, note.y);
    await expect.poll(() => selectedCount(page)).toBe(1);

    // 1 本指のドラッグ（Chrome DevTools Protocol でタッチを送る）
    const client = await page.context().newCDPSession(page);
    const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
      client.send("Input.dispatchTouchEvent", {
        type,
        touchPoints: type === "touchEnd" ? [] : [{ x, y }],
      });
    const before = await noteCenter(page, 0);
    const x = before.x + 200;
    await touch("touchStart", x, before.y + 60);
    for (let i = 1; i <= 6; i++) await touch("touchMove", x, before.y + 60 - i * 20);
    await touch("touchEnd", 0, 0);
    const after = await noteCenter(page, 0);
    expect(after.y).toBeLessThan(before.y - 100);
    // 移動しても選択はそのまま
    expect(await selectedCount(page)).toBe(1);
  });
});
