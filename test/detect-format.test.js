import { test } from "node:test";
import assert from "node:assert/strict";
import { sniffContent, resolveFormat } from "../src/parser/detect-format.js";

const buf = (s) => Buffer.from(s);

test("sniffContent recognises JSON objects and arrays, ignoring whitespace/BOM", () => {
  assert.equal(sniffContent(buf('{"data":{}}')), "json");
  assert.equal(sniffContent(buf("  \n\t[1,2]")), "json");
  assert.equal(sniffContent(Buffer.from("﻿{}", "utf8")), "json");
});

test("sniffContent recognises zip and xml by magic bytes", () => {
  assert.equal(sniffContent(buf("PK\x03\x04rest")), "zip");
  assert.equal(sniffContent(buf('<?xml version="1.0"?>')), "xml");
  assert.equal(sniffContent(buf("\n  <HealthData>")), "xml");
});

test("sniffContent returns null when unclear or empty", () => {
  assert.equal(sniffContent(buf("garbage")), null);
  assert.equal(sniffContent(Buffer.alloc(0)), null);
  assert.equal(sniffContent(null), null);
});

test("resolveFormat lets content override a misleading extension", () => {
  // JSON content uploaded to a .zip key (the failure we hit in production).
  assert.equal(resolveFormat("uploads/export-x.zip", buf('{"data":{}}')), "json");
  assert.equal(resolveFormat("uploads/export-x.json", buf("PK\x03\x04")), "zip");
});

test("resolveFormat falls back to the extension when content is unclear", () => {
  assert.equal(resolveFormat("a.json", buf("")), "json");
  assert.equal(resolveFormat("a.xml", Buffer.alloc(0)), "xml");
  assert.equal(resolveFormat("a.zip", buf("garbage")), "zip");
  assert.equal(resolveFormat("no-extension", buf("garbage")), "zip");
});
