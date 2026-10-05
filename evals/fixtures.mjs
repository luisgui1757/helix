// Synthetic, dependency-free tasks. Acceptance code runs outside agent workspaces.
export const tasks = {
  csv: {
    request: `Fix encodeRows(rows), a CSV exporter for arrays of rows containing strings,
finite numbers, booleans, null or undefined. Separate fields with commas and
rows with CRLF, with no trailing row separator. Convert null and undefined to
empty fields; preserve zero and false. Quote fields containing comma, double
quote, CR or LF, and double each embedded quote. Preserve other characters,
including surrounding spaces and Unicode. Empty input and a single empty row
produce an empty string. Do not mutate the input. Keep the named export.
Add regression tests and update README.md.`,
    source: `export function encodeRows(rows) {
  return rows.map(row => row.map(cell => String(cell || '')).join(',')).join('\\n')
}
`,
    test: `import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeRows } from './module.mjs'
test('one ordinary row', () => assert.equal(encodeRows([['a', 'b']]), 'a,b'))
`,
    checks: [
      ["empty", "assert.equal(m.encodeRows([]), '')"],
      ["empty-row", "assert.equal(m.encodeRows([[]]), '')"],
      ["row-separators", "assert.equal(m.encodeRows([['a'], ['b'], ['c']]), 'a\\r\\nb\\r\\nc')"],
      ["falsy-values", "assert.equal(m.encodeRows([[0, false, null, undefined, '']]), '0,false,,,')"],
      ["commas", "assert.equal(m.encodeRows([['a,b', 'c']]), '\"a,b\",c')"],
      ["quotes", "assert.equal(m.encodeRows([['say \"hi\"']]), '\"say \"\"hi\"\"\"')"],
      ["line-breaks", "assert.equal(m.encodeRows([['a\\rb', 'c\\nd', 'e\\r\\nf']]), '\"a\\rb\",\"c\\nd\",\"e\\r\\nf\"')"],
      ["literal-text", "assert.equal(m.encodeRows([[' ü ', '001', '=x', '\\t']]), ' ü ,001,=x,\\t')"],
      ["empty-rows-between", "assert.equal(m.encodeRows([[], ['x'], []]), '\\r\\nx\\r\\n')"],
      ["immutable-input", "const rows = Object.freeze([Object.freeze(['a,b', 0])]); assert.equal(m.encodeRows(rows), '\"a,b\",0')"],
    ],
  },
  preferences: {
    request: `Implement readPreferences(raw), a saved-preferences migration. raw is a JSON
string or null. null returns {version:2, appearance:{theme:'system', compact:false},
refreshSeconds:60}. The parsed root must be a non-null, non-array object.
Legacy records have version absent or 1, with optional theme, compact and
refreshSeconds at the root. Version 2 stores theme and compact under an optional
appearance object; refreshSeconds stays at the root. Return version 2, remove
legacy root theme/compact, and preserve unknown root fields and unknown appearance
fields in version 2. appearance is reserved for version 2 and is absent in legacy
inputs. Fill only missing known fields with the defaults above; retain false and
zero. theme must be light, dark or system; compact must be boolean;
refreshSeconds must be an integer from 0 through 3600. When appearance is present
in v2 it must be a non-null, non-array object. Invalid known values/root/appearance
throw TypeError; any explicit version other than 1 or 2 throws RangeError;
malformed JSON keeps its SyntaxError. Never silently reset invalid saved data.
Do not mutate or save input. Keep the named export. Add migration and boundary
tests and update README.md.`,
    source: `export function readPreferences(raw) {
  const saved = raw ? JSON.parse(raw) : {}
  return { theme: saved.theme || 'system', compact: saved.compact || false,
    refreshSeconds: saved.refreshSeconds || 60 }
}
`,
    test: `import test from 'node:test'
import assert from 'node:assert/strict'
import { readPreferences } from './module.mjs'
test('legacy refresh interval', () => assert.equal(readPreferences('{"refreshSeconds":30}').refreshSeconds, 30))
`,
    checks: [
      ["missing-record", "assert.deepEqual(m.readPreferences(null), {version:2, appearance:{theme:'system',compact:false},refreshSeconds:60})"],
      ["empty-legacy", "assert.deepEqual(m.readPreferences('{}'), {version:2,appearance:{theme:'system',compact:false},refreshSeconds:60})"],
      ["legacy-migration", "assert.deepEqual(m.readPreferences(JSON.stringify({version:1,theme:'dark',compact:true,refreshSeconds:0,extra:{a:1}})), {version:2,appearance:{theme:'dark',compact:true},refreshSeconds:0,extra:{a:1}})"],
      ["v2-preservation", "assert.deepEqual(m.readPreferences(JSON.stringify({version:2,appearance:{theme:'light',compact:false,font:'big'},refreshSeconds:3600,extra:[1]})), {version:2,appearance:{theme:'light',compact:false,font:'big'},refreshSeconds:3600,extra:[1]})"],
      ["partial-v2", "assert.deepEqual(m.readPreferences('{\"version\":2,\"appearance\":{\"compact\":true}}'), {version:2,appearance:{theme:'system',compact:true},refreshSeconds:60})"],
      ["missing-appearance", "assert.deepEqual(m.readPreferences('{\"version\":2}'), {version:2,appearance:{theme:'system',compact:false},refreshSeconds:60})"],
      ["bad-json", "assert.throws(() => m.readPreferences(''), SyntaxError); assert.throws(() => m.readPreferences('{'), SyntaxError)"],
      ["bad-root", "for (const v of [null,[],3,'x',true]) assert.throws(() => m.readPreferences(JSON.stringify(v)), TypeError)"],
      ["unsupported-version", "for (const version of [0,3,'2',null,false]) assert.throws(() => m.readPreferences(JSON.stringify({version})), RangeError)"],
      ["bad-appearance", "for (const appearance of [null,[],false,2,'x']) assert.throws(() => m.readPreferences(JSON.stringify({version:2,appearance})), TypeError)"],
      ["bad-theme", "for (const theme of ['',null,0,'DARK']) for (const v of [{theme},{version:2,appearance:{theme}}]) assert.throws(() => m.readPreferences(JSON.stringify(v)), TypeError)"],
      ["bad-compact", "for (const compact of [null,0,'false']) for (const v of [{compact},{version:2,appearance:{compact}}]) assert.throws(() => m.readPreferences(JSON.stringify(v)), TypeError)"],
      ["bad-interval", "for (const refreshSeconds of [null,-1,3601,0.5,'60',false]) for (const version of [1,2]) assert.throws(() => m.readPreferences(JSON.stringify({version,refreshSeconds})), TypeError)"],
      ["prototype-key-preservation", "const v = m.readPreferences('{\"__proto__\":{\"marker\":1}}'); assert.ok(Object.hasOwn(v,'__proto__')); assert.deepEqual(v.__proto__,{marker:1}); assert.equal(Object.getPrototypeOf(v),Object.prototype)"],
    ],
  },
}
