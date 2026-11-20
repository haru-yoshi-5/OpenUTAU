import { readFile } from "node:fs/promises";
import { expect, type Page, test } from "@playwright/test";

/*
 * 編集の流れと、書き出していない編集を失わないための仕組みを、実際のブラウザで確かめる。
 * デモ用サンプルの先頭 12 ノート（A メロ）を使う。「そ」は 1 番目、「に」は 3 番目のノートで、
 * どちらも元々ビブラートが無い。
 */

async function openSample(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "デモ用サンプルを開く" }).click();
  await expect(page.getByRole("heading", { name: "KOEBIT デモ" })).toBeVisible();
  await page.getByText(/^ノート一覧/).click();
}

const vibratoBox = (page: Page, nth: number, lyric: string) =>
  page.getByRole("checkbox", { name: `${nth} 番目のノート「${lyric}」のビブラート` });

const editStatus = (page: Page) => page.getByText(/個のノートを編集中|編集はありません/);

async function editTwoNotes(page: Page) {
  await vibratoBox(page, 1, "そ").check();
  await vibratoBox(page, 3, "に").check();
  await expect(editStatus(page)).toHaveText("2 個のノートを編集中");
}

test("ビブラートを切り替え、元に戻す・やり直すができる", async ({ page }) => {
  await openSample(page);
  await expect(editStatus(page)).toHaveText("編集はありません");

  await vibratoBox(page, 1, "そ").check();
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");

  await page.keyboard.press("Control+z");
  await expect(editStatus(page)).toHaveText("編集はありません");
  await expect(vibratoBox(page, 1, "そ")).not.toBeChecked();

  await page.keyboard.press("Control+Shift+z");
  await expect(editStatus(page)).toHaveText("1 個のノートを編集中");

  // 元と同じ値に戻すと、差分ではなくなる
  await vibratoBox(page, 1, "そ").uncheck();
  await expect(editStatus(page)).toHaveText("編集はありません");
});

test("編集版を書き出すと、変えたノートだけが変わったファイルになる", async ({ page }) => {
  await openSample(page);
  await editTwoNotes(page);

  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "編集を反映して書き出す" }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toBe("demo_edited.ustx");

  const original = await readFile("public/samples/demo.ustx", "utf8");
  const edited = await readFile(await download.path(), "utf8");
  const changed = edited.split("\n").filter((line, i) => line !== original.split("\n")[i]);
  expect(changed).toEqual([
    "    vibrato: {length: 75, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}",
    "    vibrato: {length: 75, period: 175, depth: 25, in: 10, out: 10, shift: 0, drift: 0, vol_link: 0}",
  ]);
});

test.describe("書き出していない編集の破棄", () => {
  test("編集があると確認ダイアログを出し、最初のフォーカスはキャンセルに置く", async ({ page }) => {
    await openSample(page);
    await editTwoNotes(page);

    await page.getByRole("button", { name: "データを破棄" }).click();
    const dialog = page.getByRole("dialog", { name: "編集を破棄しますか？" });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("2 個のノートの編集は、まだ書き出していません");
    await expect(dialog.getByRole("button", { name: "キャンセル" })).toBeFocused();

    // ダイアログを開いている間は、ショートカットで背後の編集を変えない
    await page.keyboard.press("Control+z");
    await expect(dialog).toContainText("2 個のノートの編集は");

    // Esc はキャンセル扱いで、編集は残る
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(editStatus(page)).toHaveText("2 個のノートを編集中");

    await page.getByRole("button", { name: "データを破棄" }).click();
    await dialog.getByRole("button", { name: "破棄する" }).click();
    await expect(page.getByRole("heading", { name: "USTX ファイルを読み込む" })).toBeVisible();
  });

  test("編集が無ければ確認なしで破棄する", async ({ page }) => {
    await openSample(page);
    await page.getByRole("button", { name: "データを破棄" }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByRole("heading", { name: "USTX ファイルを読み込む" })).toBeVisible();
  });

  test("編集があるときにページを閉じようとすると、ブラウザの確認が出る", async ({ page }) => {
    await openSample(page);
    await editTwoNotes(page);

    const dialogPromise = page.waitForEvent("dialog");
    void page.close({ runBeforeUnload: true });
    const dialog = await dialogPromise;
    expect(dialog.type()).toBe("beforeunload");
    await dialog.dismiss();
  });
});

test("描画中にエラーが起きても、直前の編集を取り消して表示に戻れる", async ({ page }) => {
  await openSample(page);
  await editTwoNotes(page);

  // 表示で例外になる壊れた差分を、取り消せる操作としてストアに直接入れる
  // （開発サーバーではアプリと同じモジュールを読み込めるため、同じストアを操作できる）
  await page.evaluate(async () => {
    // ホットリロード後は ?t=… 付きの URL で読み込まれているため、アプリが実際に使った URL を探す
    const loaded = performance
      .getEntriesByType("resource")
      .map((entry) => new URL(entry.name))
      .find((url) => url.pathname === "/src/stores/edit-store.ts");
    const path = loaded ? loaded.pathname + loaded.search : "/src/stores/edit-store.ts";
    const { useEditStore } = await import(/* @vite-ignore */ path);
    const { edits, undoStack } = useEditStore.getState();
    const broken = { pitch: { data: null, snap_first: true } };
    const key = "0:1";
    useEditStore.setState({
      edits: new Map([...edits, [key, broken]]),
      undoStack: [
        ...undoStack,
        { label: "壊れた編集", changes: [{ key, before: undefined, after: broken }] },
      ],
      redoStack: [],
    });
  });

  await expect(page.getByRole("heading", { name: "表示できませんでした" })).toBeVisible();
  await expect(page.getByRole("button", { name: "編集を反映して書き出す" })).toBeVisible();

  // エラー画面でも、書き出していない編集の破棄には確認が出る
  await page.getByRole("button", { name: "データを破棄" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "キャンセル" }).click();

  await page.getByRole("button", { name: "直前の編集を取り消す" }).click();
  await expect(page.getByRole("heading", { name: "表示できませんでした" })).toBeHidden();
  await expect(page.getByRole("application", { name: /ピアノロール|パート/ })).toBeVisible();
  await expect(editStatus(page)).toHaveText("2 個のノートを編集中");
});
