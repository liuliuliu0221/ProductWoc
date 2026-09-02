import assert from "node:assert/strict";
import test from "node:test";
import { slug } from "../src/slug.mjs";
test("normalizes repeated spaces", () => assert.equal(slug("Hello   World"), "hello-world"));
