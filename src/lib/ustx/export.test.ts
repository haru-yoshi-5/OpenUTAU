import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { UstxError } from "./errors";
import {
  exportUnchanged,
  serializeDocument,
  serializeVerified,
  verifyRoundTrip,
} from "./export";
import { loadUstx } from "./load";

const demoText = readFileSync(
  join(process.cwd(), "public/samples/demo.ustx"),
  "utf8",
);
const enc = (text: string) => new TextEncoder().encode(text);
const withBomCrlf = new Uint8Array([
  0xef,
  0xbb,
  0xbf,
  ...enc(demoText.replace(/\n/g, "\r\n")),
]);

describe("無変更の書き出し", () => {
  it("読み込んだバイト列と完全に一致する", () => {
    const bytes = enc(demoText);
    expect(exportUnchanged(loadUstx("demo.ustx", bytes))).toEqual(bytes);
    expect(exportUnchanged(loadUstx("demo.ustx", withBomCrlf))).toEqual(
      withBomCrlf,
    );
  });

  it("新しすぎる形式は書き出しを停止する", () => {
    const l = loadUstx(
      "a.ustx",
      enc(demoText.replace("ustx_version: 0.10", "ustx_version: 0.11")),
    );
    expect(() => exportUnchanged(l)).toThrow(UstxError);
  });
});

describe("文書の再シリアライズ（編集後の書き出し経路）", () => {
  it("再読み込みしたデータが元データと意味的に一致する", () => {
    const l = loadUstx("demo.ustx", enc(demoText));
    const out = serializeVerified(l);
    const reloaded = loadUstx("demo.ustx", out);
    expect(reloaded.doc.toJS()).toEqual(l.doc.toJS());
    expect(reloaded.project).toEqual(l.project);
  });

  it("ustx_version の表記 0.10 を 0.1 に変えない", () => {
    const out = new TextDecoder().decode(
      serializeDocument(loadUstx("demo.ustx", enc(demoText))),
    );
    expect(out).toMatch(/^ustx_version: 0\.10$/m);
  });

  it("OpenUtau と同じくシーケンスを字下げせず、ピッチ点をフロー形式のまま出力する", () => {
    const out = new TextDecoder().decode(
      serializeDocument(loadUstx("demo.ustx", enc(demoText))),
    );
    expect(out).toContain("tracks:\n- phonemizer:");
    expect(out).toContain("      - {x: -25, y: 0, shape: io}");
  });

  it("BOM と CRLF を引き継ぐ", () => {
    const out = serializeDocument(loadUstx("demo.ustx", withBomCrlf));
    expect([...out.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    const text = new TextDecoder().decode(out);
    expect(text).toContain("\r\n");
    expect(text.replace(/\r\n/g, "")).not.toContain("\n");
  });

  it("未対応のフィールドを削除しない", () => {
    const text = demoText
      .replace(
        "key: 0\n",
        "key: 0\nfuture_project_field:\n  nested: [1, 2, 3]\n  flag: true\n",
      )
      .replace(
        "    tuning: 0\n",
        "    tuning: 0\n    future_note_field: keep-me\n",
      );
    const l = loadUstx("a.ustx", enc(text));
    const out = new TextDecoder().decode(serializeVerified(l));
    expect(out).toContain("future_project_field:");
    expect(out).toContain("future_note_field: keep-me");
  });

  it("書き出し結果が期待データと異なれば検出する", () => {
    const l = loadUstx("demo.ustx", enc(demoText));
    const expected = l.doc.toJS();
    l.doc.setIn(["voice_parts", 0, "notes", 0, "tone"], 65);
    const result = verifyRoundTrip(
      { data: expected, versionRaw: "0.10" },
      serializeDocument(l),
    );
    expect(result).toEqual({
      ok: false,
      diffPath: "$.voice_parts[0].notes[0].tone",
    });
    expect(() => serializeVerified(l, expected)).toThrow(UstxError);
  });
});
