import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

/*
 * 調声プリセットのパネル（Phase 2-4）を、実際のブラウザで確かめる。
 * デモ用サンプルの A メロ（12 ノート、4 小節のフレーズ）を使う。
 */

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "デモ用サンプルを開く" }).click();
  await expect(page.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
}

const panel = (page: Page) => page.getByRole("region", { name: "調声プリセット" });
const editStatus = (page: Page) => page.getByText(/個のノートを編集中|編集はありません/);
const candidateLegend = (page: Page) => page.getByText("プリセットの候補", { exact: true });

/** ピアノロールで A メロの全ノート（4 小節のフレーズ）を選ぶ */
async function selectAll(page: Page) {
  await page.getByRole("application").focus();
  await page.keyboard.press("Control+a");
}

test("ノートを選ぶまでは候補を表示できず、選び方を案内する", async ({ page }) => {
  await openSample(page);
  await expect(panel(page)).toContainText("ノートを選ぶと、プリセットを試せます");
  await expect(panel(page).getByRole("button", { name: "候補を表示" })).toBeDisabled();
});

test("4 小節のフレーズに「切なく」を試し、採用して書き出せる。1 回の Undo で戻る", async ({
  page,
}) => {
  await openSample(page);
  await selectAll(page);
  await panel(page).getByRole("radio", { name: "切なく" }).check();
  await panel(page).getByRole("button", { name: "候補を表示" }).click();
  await expect(panel(page)).toContainText("候補：12 個のノートが変わります");
  await expect(candidateLegend(page)).toBeVisible();
  // 採用するまでは編集にならない
  await expect(editStatus(page)).toHaveText("編集はありません");

  await panel(page).getByRole("button", { name: "採用" }).click();
  await expect(editStatus(page)).toHaveText("12 個のノートを編集中");
  await expect(candidateLegend(page)).toBeHidden();

  // 書き出すと、ピッチ点が変わった USTX になる（最後のノートにはフォールが付く）
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "編集を反映して書き出す" }).click();
  const edited = await readFile(await (await downloadPromise).path(), "utf8");
  const original = await readFile("public/samples/demo.ustx", "utf8");
  expect(edited).not.toBe(original);
  expect(edited).toContain("snap_first: false");
  expect(edited).toMatch(/- \{x: [\d.]+, y: -[\d.]+, shape: io\}\n {6}snap_first/);

  // 一括で当てたプリセットは 1 回の Undo で戻る
  await page.keyboard.press("Control+z");
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("却下すると候補を捨て、編集は変わらない", async ({ page }) => {
  await openSample(page);
  await selectAll(page);
  await panel(page).getByRole("button", { name: "候補を表示" }).click();
  await expect(candidateLegend(page)).toBeVisible();
  await panel(page).getByRole("button", { name: "却下" }).click();
  await expect(candidateLegend(page)).toBeHidden();
  await expect(editStatus(page)).toHaveText("編集はありません");
  await expect(panel(page).getByRole("button", { name: "候補を表示" })).toBeEnabled();
});

test("強さを 0% にすると変化が無いことを示し、採用できない", async ({ page }) => {
  await openSample(page);
  await selectAll(page);
  await panel(page).getByRole("button", { name: "候補を表示" }).click();
  const slider = panel(page).getByRole("slider", { name: "強さ" });
  await slider.focus();
  await page.keyboard.press("Home");
  await expect(panel(page).getByText("0%", { exact: true })).toBeVisible();
  await expect(panel(page)).toContainText("この設定では、選んだノートは変わりません");
  await expect(panel(page).getByRole("button", { name: "採用" })).toBeDisabled();
});

test("キーボードだけで、プリセットを選んで採用できる", async ({ page }) => {
  await openSample(page);
  await selectAll(page);
  // ラジオボタンは矢印キーで選び直せる（「自然」→「力強く」）
  await panel(page).getByRole("radio", { name: "自然" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(panel(page).getByRole("radio", { name: "力強く" })).toBeChecked();
  await panel(page).getByRole("button", { name: "候補を表示" }).focus();
  await page.keyboard.press("Enter");
  // 押したボタンは消えるので、フォーカスは置き換わった「採用」へ移る
  await expect(panel(page).getByRole("button", { name: "採用" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(editStatus(page)).toHaveText("12 個のノートを編集中");
  // 採用したあとは、ふたたび「候補を表示」にフォーカスが戻る
  await expect(panel(page).getByRole("button", { name: "候補を表示" })).toBeFocused();
});

test("却下したあとも、キーボードのフォーカスを失わない", async ({ page }) => {
  await openSample(page);
  await selectAll(page);
  await panel(page).getByRole("button", { name: "候補を表示" }).focus();
  await page.keyboard.press("Enter");
  await page.keyboard.press("Tab");
  await expect(panel(page).getByRole("button", { name: "却下" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(panel(page).getByRole("button", { name: "候補を表示" })).toBeFocused();
});
