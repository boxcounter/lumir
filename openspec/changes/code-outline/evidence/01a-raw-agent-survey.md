# 附录 01a：探针原始日志（机器生成，未逐条复核）

本文件是 M192 探针子代理的输出原文（781 行），**未经逐条复核**；其中的分层建议是探针自己的结论，不是本批提案的口径。可引用口径以同目录 [01-language-stack-survey.md](01-language-stack-survey.md) 为准（两者冲突时一律以 01 为准）。原始日志路径：`/tmp/lezer-probe-m192/survey.md`（临时目录，会被系统清理，故在此留档）。

---



# Lezer parser survey for Lumir code mode (outline + binding-aware variable highlight)

Mission M192 probe. Workspace: `/tmp/lezer-probe-m192`. Node v26.10.0, npm 11.19.1, macOS.
Lumir repo read-only. All commands below were run from `/tmp/lezer-probe-m192`.

## 0. Setup

```
mkdir -p /tmp/lezer-probe-m192 && cd /tmp/lezer-probe-m192
npm init -y
npm install --no-audit --no-fund \
  @lezer/common @lezer/lr @lezer/highlight @lezer/generator \
  @lezer/javascript @lezer/python @lezer/rust @lezer/go @lezer/cpp @lezer/java \
  @lezer/css @lezer/html @lezer/xml @lezer/json @lezer/yaml @lezer/sass @lezer/php \
  @lezer/markdown @codemirror/language @codemirror/state \
  @codemirror/lang-sql @codemirror/lang-markdown @codemirror/lang-yaml \
  codemirror-lang-ruby @fig/lezer-bash lezer-toml \
  @fazelstudio/codemirror-lang-swift @fazelstudio/codemirror-lang-kotlin @fazelstudio/codemirror-lang-lua \
  @codincod/codemirror-lang-swift lezer-lua
# added 42 packages in 3s
npm install --no-audit --no-fund esbuild   # esbuild 0.28.2
```

Lumir's registered language set (canonical source `src/preview/code.ts:88` `LANGUAGES`,
extension map `src/preview/attachments.ts:33` `CODE_EXTENSIONS`):
rust, typescript, javascript, python, go, c, cpp, java, ruby, shell, json, toml, yaml,
css, scss, html, xml, swift, kotlin, lua, sql (21). `php → null`, `vue/svelte → html`.

## 1. Candidate hunt (Step 1)

### 1.1 Official `@lezer/*` existence check

```
for p in "@lezer/ruby" "@lezer/shell" "@lezer/toml" "@lezer/swift" "@lezer/kotlin" "@lezer/lua" "@lezer/sql" "@lezer/scss" "@lezer/typescript"; do printf "%-22s " "$p"; npm view "$p" version 2>&1 | head -1; done
```
Raw output (all E404):
```
@lezer/ruby            npm error code E404
@lezer/shell           npm error code E404
@lezer/toml            npm error code E404
@lezer/swift           npm error code E404
@lezer/kotlin          npm error code E404
@lezer/lua             npm error code E404
@lezer/sql             npm error code E404
@lezer/scss            npm error code E404
@lezer/typescript      npm error code E404
```
Direct-name probe for community candidates and `@codemirror/lang-*`:
```
codemirror-lang-ruby       0.4.4
@fig/lezer-bash            1.2.5
lezer-toml                 1.0.0
codemirror-lang-swift      npm error code E404
codemirror-lang-kotlin     npm error code E404
codemirror-lang-lua        npm error code E404
codemirror-lang-sql        npm error code E404
codemirror-lang-toml       npm error code E404
codemirror-lang-bash       npm error code E404
codemirror-lang-shell      npm error code E404
lezer-lua                  0.13.0
lezer-sql / lezer-swift / lezer-kotlin / lezer-ruby / lezer-bash   npm error code E404
@codemirror/lang-sql       6.10.0      <-- EXISTS (no @lezer/sql package)
@codemirror/lang-php       6.0.2
@codemirror/lang-sass      6.0.2       <-- scss goes through @lezer/sass (confirmed)
@codemirror/lang-vue       0.1.3
@codemirror/lang-ruby/swift/kotlin/lua/shell/toml   npm error code E404
```

### 1.2 Registry search queries run (exact commands)

```
# popularity-weighted search: returns the official packages first, and does NOT
# surface low-download community packages -> had to fall back to keyword: search
for q in "lezer%20ruby" "codemirror%20lang%20ruby" "ruby%20grammar%20lezer"; do
  curl -s "https://registry.npmjs.org/-/v1/search?text=$q&size=15" ; done
for q in "lezer%20bash" "lezer%20shell" "codemirror%20lang%20shell" "lezer%20toml" "codemirror%20toml"; do ... done
for q in "lezer%20swift" "codemirror%20lang%20swift" "lezer%20kotlin" "codemirror%20lang%20kotlin" "lezer%20lua"; do ... done
for q in "lezer%20sql" "codemirror%20lang%20sql" "lezer%20codemirror%20grammar" "lezer%20syntax%20parser"; do ... done
# second wave (rate-limited the first time; Cloudflare error code 1015 -> retried with sleeps)
for q in "lezer%20kotlin" "lezer%20lua" "lezer%20swift" "lezer%20sql"; do ... done
for q in "codemirror%20swift%20syntax" "swift%20parser%20lezer" "codemirror%20lang%20swift%20highlight"; do ... done
for q in "kotlin%20codemirror%20lezer" "lua%20codemirror%20lezer" "sql%20lezer%20grammar"; do ... done
# the query that actually found swift/kotlin/lua —— keyword search over the whole registry:
curl -s "https://registry.npmjs.org/-/v1/search?text=keywords:lezer&size=250"   # 101 objects returned
curl -s "https://registry.npmjs.org/-/v1/search?text=keywords:codemirror%20swift&size=40"
```

Outcome of the searches:
- `text=lezer ruby` / `lezer kotlin` / `lezer lua` / `lezer swift` / `lezer sql` returned
  **only the official @lezer/\* packages** (nothing language-specific). npm search is
  popularity-weighted; a name-only query cannot reach a package with <300 weekly downloads.
- `text=keywords:lezer&size=250` is the query that surfaced the real candidates
  (`@fazelstudio/codemirror-lang-{swift,kotlin,lua}`, `@codincod/codemirror-lang-swift`,
  `codemirror-lang-ruby`, `@fig/lezer-bash`, `lezer-toml`, …).

### 1.3 Candidate metadata + downloads

```
for p in codemirror-lang-ruby @fig/lezer-bash lezer-toml lezer-lua @codemirror/lang-sql \
         @fazelstudio/codemirror-lang-swift @fazelstudio/codemirror-lang-kotlin \
         @fazelstudio/codemirror-lang-lua @codincod/codemirror-lang-swift ; do
  npm view "$p" version time.modified repository.url description dependencies dist.unpackedSize dist.fileCount
  curl -s "https://api.npmjs.org/downloads/point/last-week/$p"; echo
done
```

| package | latest | last publish | repo | last-week downloads | unpacked |
|---|---|---|---|---|---|
| @lezer/javascript | 1.5.5 | 2026-09-20 | github.com/lezer-parser/javascript | (official) | — |
| @lezer/python | 1.1.19 | 2026-05-28 | github.com/lezer-parser/python | (official) | — |
| @lezer/rust | 1.0.3 | 2026-09-20 | lezer-parser/rust | (official) | — |
| @lezer/go | 1.0.1 | 2025-05-12 | lezer-parser/go | (official) | — |
| @lezer/cpp | 1.1.6 | 2026-05-28 | lezer-parser/cpp | (official) | — |
| @lezer/java | 1.1.4 | 2026-09-08 | lezer-parser/java | (official) | — |
| @lezer/css / html / xml / json / yaml / sass / php | 1.3.8 / 1.3.13 / 1.0.6 / 1.0.3 / 1.0.4 / 1.1.0 / 1.0.6 | 2024-12..2026-09 | lezer-parser/* | (official) | — |
| @codemirror/lang-sql | 6.10.0 | 2026-04-13 | github.com/codemirror/lang-sql | 3 506 103 | 146 145 B / 9 files |
| codemirror-lang-ruby | 0.4.4 | 2026-03-27 | github.com/jeanpaulsio/codemirror-lang-ruby | 507 | 248 670 B / 9 files |
| @fig/lezer-bash | 1.2.5 | **2023-02-03** (`time.modified` 2025-02-04) | github.com/withfig/lezer-bash | 2 773 | 30 901 B / 8 files |
| lezer-toml | 1.0.0 | **2022-08-15** | github.com/duncanc/lezer-toml | 238 | 26 389 B / 16 files |
| @fazelstudio/codemirror-lang-swift | 0.2.1 | 2026-09-03 | github.com/fazel-studio/codemirror-lang-swift | 11 | 142 999 B / 6 files |
| @codincod/codemirror-lang-swift | 0.3.0 | 2026-08-15 | codeberg.org/reeven/codemirror-lang-swift | 9 | 443 319 B / 14 files |
| @fazelstudio/codemirror-lang-kotlin | 0.3.0 | 2026-09-02 | github.com/fazel-studio/codemirror-lang-kotlin | 5 | 132 357 B / 10 files |
| @fazelstudio/codemirror-lang-lua | 1.0.3 | 2026-09-04 | github.com/fazel-studio/codemirror-lang-lua | 8 | 162 620 B / 13 files |
| lezer-lua | 0.13.0 | **2023-08-18** | github.com/R167/lezer-lua | **0** | 30 950 B / 12 files |

`lezer-lua` depends on `lezer@^0.13.0` — the **pre-rename, deprecated** package
(`npm warn deprecated lezer@0.13.5: This package has been replaced by @lezer/lr`). Only one
version ever published (0.13.0), 0 downloads/week. Verdict: community-dubious, do not use.

### 1.4 Per-language verdict

| lang | verdict | package |
|---|---|---|
| rust, typescript, javascript, python, go, c, cpp, java, json, yaml, css, html, xml | **official** | `@lezer/*` |
| scss | **official** (confirmed: scss → `@lezer/sass`) | `@lezer/sass` |
| sql | **official-but-token-only** | `@codemirror/lang-sql` (its own grammar, no `@lezer/sql`) |
| php | official exists (`@lezer/php`) but Lumir currently maps php→null | `@lezer/php` |
| ruby | **community-mature** (0.4.x, actively published Mar 2026, 507 dl/wk, real Lezer grammar) | `codemirror-lang-ruby` |
| swift | **community-dubious** (two single-digit-download packages, one 0.x, one huge 443 KB) | `@fazelstudio/codemirror-lang-swift` / `@codincod/codemirror-lang-swift` |
| kotlin | **community-dubious** (5 dl/wk, 0.3.0) | `@fazelstudio/codemirror-lang-kotlin` |
| lua | **community-dubious** (8 dl/wk, 1.0.3, fork-family) | `@fazelstudio/codemirror-lang-lua` |
| shell | **community-dubious** (grammar is 2023 and produces error nodes on common bash idioms, see §2.3) | `@fig/lezer-bash` |
| toml | **community-dubious** (2022, single version, unmaintained; but TOML is tiny) | `lezer-toml` |

"Flag" rule applied: last publish > 2 years → `@fig/lezer-bash` (2023-02), `lezer-toml` (2022-08),
`lezer-lua` (2023-08) are all flagged. `@fig/lezer-bash` and `lezer-toml` still get
published/used (via `time.modified` 2025-02 for the former), so they are "stale but functional".

## 2. Parser probes (Step 2)

Harness: `probe.mjs` + `probelib.mjs` (node counts via `tree.iterate`, indented DFS dump via
a `TreeCursor`, and a "same identifier name in 4 roles" pass that reports the ancestor chain
of every node whose full text equals `value`). Raw artifacts: `dump/results.json`,
`dump/summary.txt`.

### 2.0 Export shapes (`discover.mjs`)

```
@lezer/javascript .. @lezer/sass   -> { parser: LRParser }        (raw parser, no LRLanguage)
@lezer/html                        -> { parser, configureNesting }
@codemirror/lang-sql               -> { sql(), SQLDialect, StandardSQL, ... }   (no LRLanguage export)
codemirror-lang-ruby               -> { ruby(), rubyLanguage: LRLanguage }
@fazelstudio/codemirror-lang-swift -> { swift(), swiftLanguage }
@fazelstudio/codemirror-lang-kotlin-> { kotlin(), kotlinLanguage }
@fazelstudio/codemirror-lang-lua   -> { lua(), luaLanguage, luaCompletion, luaHighlighting }
@codincod/codemirror-lang-swift    -> { parser, swift(), swiftLanguage, swiftCompletion }
@fig/lezer-bash                    -> { parser: LRParser }
lezer-toml                         -> { parser: LRParser }
lezer-lua                          -> { parser: Parser }   (old @lezer/common 0.13 API)
```

Highlight props: every candidate ships `styleTags` in its dist bundle. `@lezer/*` grammars
apply the mapping to the exported `parser` itself:
`node_modules/@lezer/javascript/dist/index.js:101` `const jsHighlight = styleTags({...})`,
`:180` `propSources: [jsHighlight]`, `:192` `export { parser }`.
Verified at runtime with `getStyleTags(node)` — it returns tags for the exported parsers of
javascript, python, rust, ruby, bash, toml, lua(fazel), kotlin, sql.
=> **No hand-authored node-name→tag mapping is strictly needed for highlighting**; wrapping the
raw `@lezer/*` `parser` in `LRLanguage.define({parser})` preserves the highlight props.
(What is lost vs `@codemirror/lang-*` is the *extra* props: indent/fold/commentTokens/
autocomplete. Irrelevant for read-only code mode.)

`@lezer/javascript` needs an explicit TS dialect: `parser.configure({dialect: "ts"})`.
Without it the TS snippet yields 12 error nodes; with it, 0 error nodes and TS-only node types
(`InterfaceDeclaration`, `TypeDefinition`, `MethodType`, `PropertyType`, `IndexSignature`).
Note: `@lezer/javascript` is **one** package covering javascript + typescript + jsx.

### 2.1 Structural snippet + tree dump (verbatim, javascript / python / rust / go / java / sql)

**javascript** (`@lezer/javascript`), top node `Script`, 37 distinct node names:
```
Script [0,232)
  LineComment [1,15) "// top comment"
  VariableDeclaration [16,31) "const MAX = 42;"
    const [16,21) "const"
    VariableDefinition [22,25) "MAX"
    Equals [26,27) "="
    Number [28,30) "42"
    ; [30,31) ";"
  ClassDeclaration [32,135)
    class [32,37) "class"
    VariableDefinition [38,45) "Counter"
    ClassBody [46,135)
      { [46,47) "{"
      MethodDeclaration [50,92)
        PropertyDefinition [50,61) "constructor"
        ParamList [61,68) "(start)"
          ( [61,62) "("
          VariableDefinition [62,67) "start"
          ) [67,68) ")"
        Block [69,92) "{ this.value = start; }"
          ExpressionStatement [71,90) "this.value = start;"
            AssignmentExpression [71,89) "this.value = start"
              MemberExpression [71,81) "this.value"
                this [71,75) "this"
                . [75,76) "."
                PropertyName [76,81) "value"
              Equals [82,83) "="
              VariableName [84,89) "start"
      MethodDeclaration [95,133)
        PropertyDefinition [95,104) "increment"
        Block [107,133)
          ReturnStatement [109,131) "return this.value + 1;"
            BinaryExpression [116,130) "this.value + 1"
              MemberExpression [116,126) "this.value"
                PropertyName [121,126) "value"
  FunctionDeclaration [136,231)
    function [136,144) "function"
    VariableDefinition [145,148) "add"
    ParamList [148,154) "(a, b)"
      VariableDefinition [149,150) "a"
      VariableDefinition [152,153) "b"
    Block [155,231)
```
Full node-name histogram (37):
`VariableDefinition:7  ;:6  VariableName:6  {:4  (:4  ):4  }:4  Equals:3  ParamList:3  Block:3  MemberExpression:3  .:3  PropertyName:3  BinaryExpression:3  ArithOp:3  VariableDeclaration:2  Number:2  MethodDeclaration:2  PropertyDefinition:2  ExpressionStatement:2  this:2  ReturnStatement:2  return:2  Script:1  LineComment:1  const:1  ClassDeclaration:1  class:1  ClassBody:1  AssignmentExpression:1  FunctionDeclaration:1  function:1  ,:1  let:1  CallExpression:1  ArgList:1  String:1`

**python** (`@lezer/python`), top node `Script`, 27 distinct node names — dump excerpt:
```
  AssignStatement [15,23) "MAX = 42"
    VariableName [15,18) "MAX"
    AssignOp [19,20) "="
  ClassDefinition [24,152)
    class [24,29) "class"
    VariableName [30,37) "Counter"
    Body [37,152)
      FunctionDefinition [43,97)
        def [43,46) "def"
        VariableName [47,55) "__init__"
        ParamList [55,68) "(self, start)"
        Body [68,97)
          AssignStatement [78,96) "self.value = start"
            MemberExpression [78,88) "self.value"
              VariableName [78,82) "self"
              . [82,83) "."
              PropertyName [83,88) "value"
  FunctionDefinition [152,238)
    def [152,155) "def"
    VariableName [156,159) "add"
    Body [165,238)
      AssignStatement [171,184) "value = a + b"
        VariableName [171,176) "value"
```
**rust** (`@lezer/rust`), top node `SourceFile`, 46 distinct node names:
```
  ConstItem [16,36) "const MAX: i32 = 42;"
    const [16,21)
    BoundIdentifier [22,25) "MAX"
    TypeIdentifier [27,30) "i32"
  StructItem [37,66)
    struct [37,43)
    TypeIdentifier [44,51) "Counter"
    FieldDeclarationList [52,66)
  ImplItem ...
    FunctionItem (fn new / fn increment)
  FunctionItem (fn add)
    BoundIdentifier (add) ... LetDeclaration -> BoundIdentifier (value)
    MacroInvocation -> ParenthesizedTokens -> Identifier (value)
```
**go** (`@lezer/go`), top node `SourceFile`, 41 distinct node names:
```
  ConstDecl [16,30) -> ConstSpec -> DefName [22,25) "Max"
  TypeDecl [31,64) -> TypeSpec -> DefName "Counter" + StructType -> StructBody -> FieldDecl -> FieldName "value"
  MethodDecl [65,120) -> Parameters -> Parameter -> DefName "c"; FieldName [82,91) "Increment"
  FunctionDecl [121,222) -> DefName "Add"; Parameter -> DefName; Block
      SelectorExpr -> VariableName "c" + FieldName "value"
```
**java** (`@lezer/java`), top node `Program`, 48 distinct node names:
```
  ClassDeclaration [16,202)
    Modifiers -> public
    Definition [29,36) "Counter"
    ClassBody [37,202)
      FieldDeclaration [43,69) -> Modifiers + PrimitiveType + VariableDeclarator -> Definition [60,63) "MAX"
      FieldDeclaration [74,92) "private int value;" -> VariableDeclarator -> Definition "value"
      ConstructorDeclaration -> Definition "Counter" + FormalParameters -> FormalParameter -> Definition "start"
      MethodDeclaration [151,200) -> PrimitiveType int + Definition [162,171) "increment" + Block
```
**sql** (`@codemirror/lang-sql`), top node `Script`, 14 distinct node names — **flat, token-level**:
```
  Statement [16,57)
    Keyword [16,22) "CREATE"
    Keyword [23,28) "TABLE"
    Identifier [29,36) "counter"
    Parens [37,56) "(id INT, value INT)"
      Identifier [38,40) "id"
      Type [41,44) "INT"
      Keyword [46,51) "value"          <-- `value` is a KEYWORD, not an Identifier
  Statement [58,125)
    Keyword "CREATE" Keyword "FUNCTION" Identifier "increment" ...
    ⚠ [106,108) "$$"   ⚠ [122,124) "$$"   <-- dollar-quoted body is an error node
  Statement [126,169)
    Keyword "SELECT" Keyword "value" Keyword "FROM" Identifier "counter" Keyword "WHERE" Keyword "value"
```
`Statement` is the only structural node and it is per-semicolon, not per-declaration.
Verdict for SQL: **outline-capable = NO; declaration/reference distinction = NO.**

### 2.2 Declaration / reference node names per parser

| lang | function/method decl | class/type/struct decl | const/var decl | identifier reference | decl vs ref distinguishable? |
|---|---|---|---|---|---|
| javascript | `FunctionDeclaration`(name=`VariableDefinition`), `MethodDeclaration` | `ClassDeclaration` | `VariableDeclaration`→`VariableDefinition` | `VariableName` | YES |
| typescript (`dialect:"ts"`) | `FunctionDeclaration`, `MethodDeclaration` | `ClassDeclaration`, `InterfaceDeclaration`, `TypeAliasDeclaration`, `EnumDeclaration` | `VariableDeclaration`→`VariableDefinition` | `VariableName`, `TypeName` | YES |
| python | `FunctionDefinition` (name=`VariableName`) | `ClassDefinition` | `AssignStatement`→`VariableName` | `VariableName`, `MemberExpression`→`PropertyName` | **PARTIAL** — decl vs ref both `VariableName`; disambiguated only by parent (`AssignStatement`/`ParamList`/`FunctionDefinition` vs others) |
| rust | `FunctionItem` (name=`BoundIdentifier`) | `StructItem`, `EnumItem`, `TraitItem` (`TypeIdentifier`) | `ConstItem`/`StaticItem`/`LetDeclaration`→`BoundIdentifier` | `Identifier`, `FieldExpression`→`FieldIdentifier` | YES |
| go | `FunctionDecl`, `MethodDecl` (name=`DefName`) | `TypeDecl`→`TypeSpec`(struct/interface) | `ConstDecl`→`ConstSpec`, `VarDecl`→`DefName` | `VariableName`, `SelectorExpr`→`FieldName` | YES (but method NAME is `FieldName`, same type as struct field refs → needs parent check) |
| c / cpp | `FunctionDefinition`→`FunctionDeclarator`; cpp additionally `ClassSpecifier`, `FieldDeclaration` | `StructSpecifier`/`ClassSpecifier` (`TypeIdentifier`) | `Declaration`→`InitDeclarator` | `Identifier`, `FieldExpression`→`FieldIdentifier` | YES for members (`FieldIdentifier`), **NO** for locals vs refs (both `Identifier`) |
| java | `MethodDeclaration` (name=`Definition`), `ConstructorDeclaration` | `ClassDeclaration`, `InterfaceDeclaration` (name=`Definition`) | `FieldDeclaration`/`LocalVariableDeclaration`→`VariableDeclarator`→`Definition` | `Identifier`, `FieldAccess`→`Identifier`, `MethodInvocation`→`MethodName` | YES |
| ruby | `MethodDef` (name=`Identifier`) | `ClassDef`, `ModuleDef` (`Constant`) | `Assignment`→`Identifier`; `Constant` for `MAX` | `Identifier`, `InstanceVariable` | **PARTIAL** — `MethodDef`'s own name and a local read are both `Identifier`; parent check needed |
| shell (`@fig/lezer-bash`) | `FunctionDefinition`→`Functionname` | none | `Assignment`→`VariableName` | `VariableName`, `EnvironmentVariable`→`VariableName`, `CommandName` | YES for functions; variables partial |
| swift (`@fazelstudio`) | `FunctionDeclaration`→`FunctionName` | `StructDeclaration`, `ClassDeclaration`, `EnumDeclaration` (`TypeIdentifier`) | `VariableDeclaration`→`PatternInitializer`→`Pattern`→`Identifier` | `Identifier`, `PrimaryExpression`→`Identifier` | **PARTIAL** — `Pattern` (decl) vs `Identifier` in expression (ref) |
| swift (`@codincod`) | `FunctionDeclaration`→`FunctionName` | `StructDeclaration` (→`TypeDefinition`), `TypeDefinition` | `VariableDeclaration`→`Binding`→**`VariableDefinition`** | `Identifier` | YES — `VariableDefinition` is a dedicated declaration node |
| kotlin (`@fazelstudio`) | `FunctionDeclaration`→`FunctionValueParameters`; name via `Identifier` under `Declaration` | `ClassDeclaration`, `PrimaryConstructor` | `PropertyDeclaration`→`Binding` | `Identifier` (inside `PrimaryExpression`) | **PARTIAL** — deducing the *name* from `FunctionDeclaration` requires descending to the first `Identifier`; references are plain `Identifier` |
| lua (`@fazelstudio`) | `LocalFunctionDeclaration`, `FunctionDeclaration`→`FuncName` | none (tables only) | `LocalDeclaration`→`AttNameList`→`AttName`→`VariableName`; `Assignment` | `VariableName`, `IndexProp`→`Identifier`, `FieldName` | YES-ish |
| json | n/a | n/a | `Property`→`PropertyName` (key) | `String`/`Number`/`True`/`Null` (members) | keys vs values YES |
| toml | n/a | `TableHeader` (table/array-of-table) | `Pair`→`BareKey` | n/a (values) | keys vs values YES |
| yaml | n/a | n/a | `Pair`→`Key` | `Literal`/alias | keys vs values YES |
| css | n/a | n/a | `Declaration`→`PropertyName`; custom props via `VariableName` | `ClassName`, `IdName`, `ValueName`, `FeatureName`, `PseudoClassName` | YES (selector kinds are distinct node types) |
| scss (`@lezer/sass`) | `MixinStatement` (definition), `IncludeStatement` (use), `CallExpression`→`Callee` | n/a | `Declaration`→`PropertyName`; `SassVariableName` for `$x` | `ClassName`, `ValueName`, `Callee` | YES for `$vars` (`SassVariableName`) |
| html | n/a | `Element` | n/a | `TagName`, `AttributeName`, `AttributeValue`, `Text` | YES |
| xml | n/a | `Element` | n/a | `TagName`, `AttributeName`, `AttributeValue`, `Text` | YES |
| sql | NO declaration nodes at all | — | — | `Identifier` (but `VALUE` etc. lex as `Keyword`) | **NO** |

### 2.3 False-positive probe: same name `value` as local / member / string content / comment

Snippet used per language (verbatim, javascript shown; the rest are per-language equivalents
in `probe.mjs`):
```js
// value in comment
const value = 1;
const obj = { value: 2 };
obj.value = obj.value + 1;
const s = "value";
function f() { let value = 3; return value; }
```
Reported as `nodeName <- parents…` for every node whose *complete* text is `value`:

| lang | occurrences (node ← ancestor chain) |
|---|---|
| javascript | `VariableDefinition < VariableDeclaration < Script` (local decl) · `PropertyDefinition < Property < ObjectExpression < VariableDeclaration` (object key) · `PropertyName < MemberExpression < AssignmentExpression` (member ref ×2) · `VariableDefinition < VariableDeclaration < Block < FunctionDeclaration` (block-local decl) · `VariableName < ReturnStatement < Block < FunctionDeclaration` (local read) |
| python | `VariableName < AssignStatement < Script` · `PropertyName < MemberExpression < AssignStatement` · `PropertyName < MemberExpression < BinaryExpression < AssignStatement` · `VariableName < AssignStatement < Body < FunctionDefinition` · `VariableName < ReturnStatement < Body < FunctionDefinition` |
| rust | `BoundIdentifier < ConstItem` · `FieldIdentifier < FieldDeclaration < StructItem` · `BoundIdentifier < LetDeclaration < Block < FunctionItem` · `Identifier < ExpressionStatement < Block < FunctionItem` |
| go | `DefName < ConstSpec < ConstDecl` · `FieldName < FieldDecl < StructBody < StructType < TypeSpec` · `DefName < VarDecl < Block < FunctionDecl` · `VariableName < ReturnStatement < Block < FunctionDecl` |
| c / cpp | `Identifier < PreprocDirective` (a `#define`) · `FieldIdentifier < FieldDeclaration < FieldDeclarationList < StructSpecifier` · `Identifier < InitDeclarator < Declaration < CompoundStatement < FunctionDefinition` · `Identifier < ReturnStatement < CompoundStatement < FunctionDefinition` |
| java | `Definition < VariableDeclarator < FieldDeclaration < ClassBody < ClassDeclaration` · `Definition < VariableDeclarator < LocalVariableDeclaration < Block < MethodDeclaration` |
| ruby | `Identifier < Assignment < Program` · `Identifier < HashPair < Hash < Assignment` · `Identifier < MethodCall < Assignment` · **`StringContent < InterpolatedString < Assignment`** (the `"value"` literal — lands in `StringContent`) · `Identifier < Assignment < MethodBody < MethodDef` |
| shell | `VariableName < Assignment < Command < CompleteCommand` · `VariableName < EnvironmentVariable < Arg < Command` |
| swift (fazel) | `Pattern < PatternInitializer … < VariableDeclaration` + `Identifier < Pattern …`; then `Expression`/`PrimaryExpression`/`Identifier` chains for the read |
| swift (codincod) | `VariableDefinition < Binding < VariableDeclaration …` · `Identifier < VariableDefinition …` · `Identifier < ReturnStatement < Block < FunctionDeclaration` |
| kotlin | `Binding < PropertyDeclaration` + `Identifier < Binding`; reads appear as `Identifier < PrimaryExpression < PostfixExpression < … < PropertyDeclaration` |
| lua (fazel) | `AttName < AttNameList < LocalDeclaration` + `VariableName < AttName` · `FieldName < NamedField < Field < FieldList < TableConstructor` · `Identifier < IndexProp < Var < Assignment` · `Identifier < IndexProp < PrefixExp …` |
| css | `ClassName < ClassSelector < RuleSet < StyleSheet` · `ValueName < AttributeSelector < RuleSet < StyleSheet` |
| scss | `ClassName < ClassSelector` · `Callee < CallExpression < MixinStatement` |
| html | `Text < Element < Document` (attribute values carry their quotes, so `id="value"` is `AttributeValue` = `"value"` with quotes and is NOT matched as `value`) |
| xml | `TagName < OpenTag < Element` · `Text < Element` · `TagName < CloseTag < Element` |
| sql | **all four occurrences land in `Keyword`** (`VALUE` is a reserved word in the SQL tokenizer) |
| json | none — `PropertyName` includes the quotes, so the exact-text match finds nothing (use `text.slice(from+1, to-1)` for JSON keys) |
| toml | `BareKey < Pair < TopLevelTable` · `BareKey < TableHeader < Table` · `BareKey < Pair < Table` |
| yaml | none reported (keys are `Key`→`Literal`; `Literal` covers the whole `value` token) |

Key takeaways for the "same binding, not string match" requirement:
- **Strings/comments are naturally excluded** in every language tested: the word inside a string
  live inside a `String`/`StringContent`/`InterpolatedString`/`Text` node, and inside a comment
  inside a `Comment`/`LineComment`/`BlockComment` node. A binder that only considers
  identifier-ish node types never even sees them. ✔
- **Same-name-different-category is mostly resolvable by node name**: e.g. JS `VariableDefinition`
  (decl) vs `PropertyName` (member) vs `VariableName` (ref); Go `DefName` vs `FieldName` vs
  `VariableName`; Rust `BoundIdentifier` vs `FieldIdentifier` vs `Identifier`; Java `Definition`
  vs `Identifier` vs `MethodName`. ✔
- **Residual ambiguity (needs a scope walk, not just node names)**: python/ruby/c/cpp/kotlin/
  swift(fazel)/shell use ONE node type for both declarations and references, or for the
  function's own name vs a local read. For those, "declaration vs reference" is decided by the
  *parent* node (`ParamList`/`AssignStatement`/`FunctionDefinition` = declaration site), and
  "same binding" still needs the nearest-enclosing-scope rule.

### 2.4 Scope encoding — can a reference be resolved to its declaration?

Explicit scope-bearing nodes exist in every real grammar:

| lang | scope node names | honest assessment of a conservative "same binding" algorithm |
|---|---|---|
| javascript/ts | `Block`, `ClassBody`, `FunctionDeclaration`(+`ParamList`), `ArrowFunction`, `StaticBlock` | CAN: nearest enclosing `Block`/function for `let`/`const`; `var` hoisting and closures over outer scopes are NOT modelled (no binder) — a same-`Block`-subtree ancestor rule gets ~90% right, and is conservative (may miss a few valid matches, will not match wrong ones if it also requires the same node-name category) |
| python | `Body` (of `Module`/`FunctionDefinition`/`ClassDefinition`) | CAN: nearest enclosing `Body`; CANNOT: `global`/`nonlocal`, comprehension scopes, class-vs-instance attribute distinction (both are `PropertyName` under different expressions) |
| rust | `Block`, `DeclarationList`, `FieldDeclarationList` | Partially — `let` shadowing chains and `impl` method scopes are visible; macro bodies (`MacroInvocation`) are opaque token soup |
| go | `Block`, `StructBody` | CAN: nearest `Block` for `DefName`; `FieldName`/`SelectorExpr` = member access (different binding class) — good |
| c/cpp | `CompoundStatement`, `FieldDeclarationList` | Partially — no type info, so `a.b` vs `a->b` vs a local `a` cannot be separated beyond the node name (`FieldExpression`/`FieldIdentifier`) |
| java | `Block`, `ClassBody`, `ConstructorBody`, `MethodDeclaration` | CAN: nearest `Block`/`MethodDeclaration`; fields vs locals distinguishable (`FieldDeclaration` vs `LocalVariableDeclaration`) |
| ruby | `MethodBody`, `ClassBody`, `Program` | Partially — Ruby has no `local` declaration node; `Assignment` LHS vs bare `Identifier` read is the only signal; blocks (`do…end`) are not distinct scopes here |
| kotlin | `Block`, `ClassBody`, `FunctionBody`, `PropertyDeclaration` | Partially — deep expression chain nesting means "nearest enclosing declaration node" must skip expression nodes; `Binding` marks the decl name |
| swift (fazel / codincod) | `CodeBlock`, `MemberBody`/`MemberBlock`, `Block`, `FunctionDeclaration` | codincod's `VariableDefinition` makes decl/reference clean; fazel's `Pattern` vs `PrimaryExpression` is workable |
| lua | `Block`, `FunctionBody`, `LocalDeclaration`, `Var` | CAN: `local` decls are explicit; globals fall back to file scope |
| shell | `BraceGroup`, `Subshell`, `FunctionDefinition`, `CommandSubstitution` | Weak — shell is dynamic; `local` is not even a keyword in the grammar (produces ⚠, §2.5) |
| css/scss | `Block`, `RuleSet` | Different problem: "variables" are `SassVariableName`/`VariableName`/custom properties; no lexical binding, only cascade — a "same binding" highlight is not meaningful, only "same token name within the same rule" |
| html/xml | `Element` | N/A — no variables |
| json/toml/yaml | document/table nodes only | N/A — no variables |

Honest summary: **no Lezer grammar ships a binder.** They all ship a *concrete syntax tree with
explicit lexical-scope nodes*. A conservative algorithm — "two identifier tokens match iff they
have the same text, the same declaration/reference node category, and the nearest enclosing
scope node subtree also contains a matching declaration node of that name" — is implementable
per language and will never produce a *string*-false-positive (strings/comments excluded), but
it will be conservative on shadowing, closures, `var` hoisting, and dynamic languages.

### 2.5 Error-node density (quality signal)

`⚠` (= error node) counts for the structural snippet / ambiguity snippet:

| lang | errors (structural) | errors (ambiguity) |
|---|---|---|
| javascript | 0 | 0 |
| typescript (as JS parser) | 12 | 0 |
| typescript (`dialect:"ts"`) | **0** | 0 |
| python | 0 | 0 |
| rust | 0 | 0 |
| go | 0 | 0 |
| c | 0 | 0 |
| cpp | 0 | 0 |
| java | 0 | 0 |
| ruby | 0 | 0 |
| shell | **11** | 0 |
| json | 0 | 0 |
| toml | 0 | 0 |
| yaml | 0 (but see §2.6) | 0 |
| css | 0 | 0 |
| scss | 0 | 0 |
| html | 0 | 0 |
| xml | 0 | 0 |
| swift (fazel) | 0 | 0 |
| kotlin (fazel) | 0 | 0 |
| lua (fazel) | 0 | 0 |
| sql | **2** (`$$…$$` dollar quoting) | 0 |
| swift (codincod) | 0 | 0 |

`@fig/lezer-bash` failure matrix (probed directly):
```
"local x=1"    errors: 1   (⚠ on the "=")
"x=1"          errors: 0
"n=$((1+2))"   errors: 1   (⚠ inside $(( )) arithmetic)
"echo hi # note" errors: 0
"f() { echo hi; }" errors: 0
"function f { ... }" errors: 1
```
So `@fig/lezer-bash` fails on `local NAME=value`, `$(( ))` arithmetic and the `function` keyword —
i.e. on most real-world bash scripts. It handles POSIX-style `name=value`, `f() {…}`, comments.

### 2.6 YAML: a real position-corruption bug in `@lezer/yaml` 1.0.4 (and `@codemirror/lang-yaml`)

Reproduction (also affects the official `@codemirror/lang-yaml` wrapper — identical result):
```
parser.parse("\n# c\nkey: 1\n")
  topNode: Stream 0 12
  tree.toString(): "Stream(Comment,Document(BlockMapping(Pair(Key(Literal),\":\",Literal))))"
  manual child walk:
    Stream [0,12)
      Comment [1,4)
      Document [65536,11)          <-- from = 65536 = 2^16, i.e. from > to
        BlockMapping [65536,11)
          Pair [5,11) Key [5,8) : [8,9) Literal [10,11)
```
`from = 65536` breaks everything position-based:
- `tree.iterate(...)` visits only `Stream,Comment` (the subtree is unreachable),
- `tree.resolveInner(posInKey, 1)` returns `Stream` (not the key/pair),
- therefore highlighting and any outline/binding pass silently see an empty document.

Trigger matrix (all reproduced):
| input | corrupted nodes |
|---|---|
| `# c\nkey: 1\n` (comment on line 1) | none — OK |
| `\nkey: 1\n` (blank line, no comment) | none — OK |
| `key: 1\n# c\nother: 2\n` (comment after content) | none — OK |
| `\n# c\n- a\n- b\n` (blank + comment + block **sequence**) | none — OK |
| `\n# c\nkey: 1\n` (blank + comment + block **mapping**) | **Document, BlockMapping corrupted** |
| `\n# c\nkey: 1\nother: 2\n` | **corrupted** |
| `\n# c\n# d\nkey: 1\n` (2 comments) | **corrupted** |

`npm view @lezer/yaml version` → `1.0.4` is the latest, so this is not fixed by upgrading.
A web search did not surface a matching tracked upstream issue
(nearest hits are unrelated: `[YAML] Parser does not handle empty lines before comment`
is a PHP/symfony issue; `Comments before document start get misplaced` is a Go yaml issue).
**Treat as an empirically reproduced defect in the current release; not confirmed as a
tracked upstream bug.** Practical mitigation: treat "block mapping that follows a
blank line + comment" as a known-broken region, or prepend a `---`/rely on `Document`
reachability checks, or fall back to a StreamLanguage/indentation heuristic for YAML outline.

## 3. Bundle size (Step 3)

Entries in `ent/<name>.js` (each just re-exports the parser), then:
```
./node_modules/.bin/esbuild --bundle --minify --format=esm --log-level=error \
  --outfile=out/<lang>.js \
  --external:@lezer/lr --external:@lezer/common --external:@codemirror/* --external:@lezer/highlight \
  ent/<lang>.js
gzip -c out/<lang>.js | wc -c
```
`@codemirror/lang-sql` was measured with an explicit external list
(`--external:@codemirror/state --external:@codemirror/language --external:@codemirror/autocomplete
--external:@codemirror/view --external:@lezer/lr --external:@lezer/common --external:@lezer/highlight`)
because the `@codemirror/*` wildcard also externalised the entry package itself (produced a
bogus 61-byte bundle first — recorded here for honesty).

| entry | minified B | gzip B |
|---|---|---|
| javascript (all externals) | 77 751 | 29 895 |
| javascript (no externals, fully bundled) | **129 228** | **46 756** |
| javascript (`--external:@lezer/lr --external:@lezer/common` only) | 83 167 | 31 893 |
| _runtime (bundle of `@lezer/lr` + `@lezer/common` + `tags` from `@lezer/highlight`) | **59 350** | **19 533** |
| @lezer/highlight alone (`tags`,`styleTags`,`getStyleTags`) | 24 245 | 8 407 |
| python | 37 959 | 15 826 |
| rust | 83 172 | 29 233 |
| go | 27 060 | 10 807 |
| cpp (covers c **and** cpp) | 103 226 | 32 935 |
| java | 39 481 | 15 612 |
| css | 17 205 | 7 927 |
| sass (scss) | 22 362 | 9 630 |
| html | 12 946 | 5 424 |
| xml | 8 627 | 3 558 |
| json | 1 705 | 1 068 |
| yaml | 10 759 | 4 719 |
| php | 96 890 | 27 427 |
| ruby (codemirror-lang-ruby) | 85 210 | 29 273 |
| bash (@fig/lezer-bash) | 13 581 | 5 448 |
| toml (lezer-toml) | 6 534 | 2 794 |
| swift (@fazelstudio) | 63 535 | 27 676 |
| swift (@codincod) | 109 673 | 48 623 |
| kotlin (@fazelstudio) | 57 826 | 26 214 |
| lua (@fazelstudio) | 25 429 | 8 835 |
| lezer-lua (0.13, deprecated) | 46 140 | 16 844 |
| @codemirror/lang-sql | 32 276 | 12 940 |

Runtime share (the part every grammar would otherwise duplicate): **~59 KB min / ~19.5 KB gzip**
for `@lezer/lr` + `@lezer/common` + the highlight `tags` object. Confirmed by the javascript
pair: 77 751 B with all externals vs 129 228 B fully bundled → ~51.5 KB of that difference is
the shared runtime.
Note Lumir **already** ships `@codemirror/language` + `@lezer/highlight` (see
`src/preview/code.ts:21-23`), so a large part of this runtime is already in the bundle.

## 4. Parse-time probe (Step 4)

`perf.mjs`: synthetic file built by repeating a representative unit; `parser.parse(text)`
5 runs, median reported; then a full `tree.iterate` walk, 5 runs, median.

| lang | size | parse median | parse max | iterate-walk median | node count | err nodes |
|---|---|---|---|---|---|---|
| python | 100 KB | 29.8 ms | 34.4 | 0.9 ms | 39 388 | 0 |
| python | 1024 KB | **266.6 ms** | 275.2 | 6.3 ms | 403 304 | 0 |
| rust | 100 KB | 28.7 | 31.1 | 0.6 | 40 376 | 1 |
| rust | 1024 KB | **290.6** | 295.0 | 6.3 | 413 388 | 2 |
| javascript | 100 KB | 25.7 | 28.2 | 0.7 | 41 178 | 3 |
| javascript | 1024 KB | **267.9** | 277.5 | 6.8 | 421 593 | 0 |
| go | 100 KB | 23.6 | 25.1 | 0.6 | 42 492 | 2 |
| go | 1024 KB | 248.5 | 257.8 | 6.4 | 435 050 | 1 |
| cpp | 100 KB | 28.7 | 34.8 | 0.6 | 37 326 | 1 |
| cpp | 1024 KB | **289.9** | 297.0 | 6.1 | 382 199 | 2 |
| java | 100 KB | 16.6 | 24.1 | 0.7 | 38 409 | 2 |
| java | 1024 KB | 166.3 | 174.3 | 6.0 | 393 225 | 2 |
| css | 100 KB | 19.3 | 21.6 | 0.7 | 44 379 | 2 |
| css | 1024 KB | 225.3 | 230.8 | 6.9 | 454 388 | 2 |
| html | 100 KB | 9.6 | 10.1 | 0.7 | 45 525 | 2 |
| html | 1024 KB | **97.7** | 99.9 | 6.8 | 466 057 | 2 |
| json | 100 KB | 7.5 | 9.3 | 0.8 | 50 161 | 3 |
| json | 1024 KB | **77.8** | 91.1 | 8.0 | 513 595 | 2 |
| yaml | 100 KB | 16.2 | 61.5 | 0.8 | 50 239 | 1 |
| yaml | 1024 KB | 180.3 | 186.1 | 8.0 | 514 401 | 1 |

(The 1–3 "error nodes" are artifacts of slicing the synthetic text mid-token; not grammar
failures. All parsers produced a **full** tree — ~400 K nodes per 1 MB.)

Interpretation against Lumir's stated contract (keypress→paint < 16 ms; 1 MB open < 100 ms):
- A **single synchronous full parse of a 1 MB code file costs 78–291 ms** — over the 100 ms
  budget for every language except json (78 ms) and html (98 ms).
- Reading the parsed tree (`iterate` over 400 K nodes) is cheap: 6–8 ms.
- This is *not* automatically a contract violation: CodeMirror's Lezer integration parses
  lazily/incrementally with a work budget (`ViewPlugin` parse slice) and only forces a parse up
  to the viewport, continuing in the background — so "open a 1 MB code file" is not a
  1 MB synchronous parse on the open path. But an *outline panel* that wants the whole file's
  declarations **on open** does need a full parse, and that is 100–300 ms of main-thread work
  for a 1 MB file unless it is moved to a worker or deferred until after first paint.

## 5. `codeLanguages` architecture answer (Step 6)

### 5.1 The API

`@codemirror/lang-markdown/dist/index.d.ts:66-116`:
```ts
declare function markdown(config?: {
    defaultCodeLanguage?: Language | LanguageSupport;                       // :71
    codeLanguages?: readonly LanguageDescription[]                          // :80
        | ((info: string) => Language | LanguageDescription | null);
    addKeymap?: boolean; extensions?: MarkdownExtension; base?: Language;
    completeHTMLTags?: boolean; pasteURLAsLink?: boolean;
    htmlTagLanguage?: LanguageSupport;
}): LanguageSupport;
```
So: the **array form only accepts `LanguageDescription` objects**; the **function form accepts a
plain `Language`** (and `LRLanguage extends Language`, so any Lezer language qualifies).
Implementation `@codemirror/lang-markdown/dist/index.js:75-92` (`getCodeParser`):
- array form → `LanguageDescription.matchLanguageName(languages, info, true)`, then
  `found.support ? found.support.language.parser : ParseContext.getSkippingParser(found.load())`;
- function form → `else if (found) return found.parser;`
- `@codemirror/lang-markdown/dist/index.js:421-422`:
  `let codeParser = codeLanguages || defaultCode ? getCodeParser(codeLanguages, defaultCode) : undefined;`
  `extensions.push(parseCode({ codeParser, htmlParser: htmlTagLanguage.language.parser }));`

The nested parse itself is `parseCode` from `@lezer/markdown`
(`@lezer/markdown/dist/index.d.ts:535-549`, impl `dist/index.js:2002-2023`):
```js
function parseCode(config) {
  let { codeParser, htmlParser } = config;
  let wrap = parseMixed((node, input) => {
    let id = node.type.id;
    if (codeParser && (id == Type.CodeBlock || id == Type.FencedCode)) {
      let info = "";
      if (id == Type.FencedCode) { let infoNode = node.node.getChild(Type.CodeInfo); if (infoNode) info = input.read(infoNode.from, infoNode.to); }
      let parser = codeParser(info);
      if (parser) return { parser, overlay: node => node.type.id == Type.CodeText, bracketed: id == Type.FencedCode };
    } else if (htmlParser && (...)) { ... }
    return null;
  });
  return { wrap };
}
```
Node types: `Type.CodeText = 40`, `Type.CodeInfo = 41` (`@lezer/markdown/dist/index.js:79-80`).
The info string is read from the **`CodeInfo`** child; the nested tree is mounted with
**`overlay = the `CodeText` node's range`** and `bracketed: true`.

### 5.2 Verified behaviour (my own probe, `mdtest6.mjs`, `mdtest4.mjs`)

```
src = "```python\ndef add(a, b):\n    return a + b\n```\n"

LanguageDescription.of(...) in codeLanguages : NESTS  (resolveInner(20) = ParamList < FunctionDefinition < Script < FencedCode < Document)
codeLanguages: (info) => LRLanguage           : NESTS  (same chain)
defaultCodeLanguage: new LanguageSupport(L)   : NESTS  (same chain)
codeLanguages: [ {name, alias, support} ]     : DOES NOT NEST (resolveInner(20) = CodeText < FencedCode < Document)
```

Three behaviours worth quoting:

1. **A plain object literal in the array form silently does nothing.** You must build real
   `LanguageDescription` instances (`LanguageDescription.of({name, alias, support})`) or use the
   function form. This is a footgun — no error, no warning, just no nesting.

2. **The nested tree is not visible to `tree.iterate` / `tree.cursor()`.** Raw proof:
   ```
   tree.toString()  = "Document(FencedCode(CodeMark,CodeInfo,CodeText,CodeMark))"
   tree.iterate({enter}) -> Document, FencedCode, CodeMark, CodeInfo, CodeText   (5 nodes)
   tree.resolveInner(20,1) -> ParamList < FunctionDefinition < Script < FencedCode < Document
   ```
   `iterate` skips overlay-mounted trees (`@lezer/common/dist/index.js:763`
   `if (!(mode & IterMode.IgnoreMounts) && (mounted = MountedTree.get(next)) && !mounted.overlay)`
   — only **overlay-less** mounts are entered during iteration). Overlay mounts are entered only
   by `resolveInner` / `node.enter(pos, side)` (`index.js:788`). `IterMode.EnterBracketed` and
   `IterMode.IgnoreOverlays` did **not** make `iterate` descend.
   The canonical consumer that does it manually is `highlightTree`
   (`@lezer/highlight/dist/index.js:399-401`):
   `let mounted = cursor.tree && cursor.tree.prop(NodeProp.mounted); … let inner = cursor.node.enter(mounted.overlay[0].from + start, 1);`
   → **an outline/binding pass over fenced blocks must use `resolveInner`/`node.enter`, not
   `iterate`.** That is a real implementation constraint, not a theoretical one.

3. `@codemirror/lang-markdown/dist/index.js:414-420`: if `defaultCodeLanguage` is a
   `LanguageSupport`, its `.support` extensions are added to the editor
   (`support.push(defaultCodeLanguage.support)`), which is how nested languages get their own
   indent/fold/autocomplete contributions.

### 5.3 Feasibility verdict

Yes — nesting real Lezer parsers through `markdown({codeLanguages})` is feasible and gives one
tree-based pipeline shared by fenced blocks and whole-file code mode:
- define each language once as `LRLanguage.define({ name, parser })` (the raw `@lezer/*` parser
  already carries its `styleTags` props, so highlighting survives),
- feed the same `LRLanguage` objects both to the code-mode editor extension and to
  `markdown({ codeLanguages: (info) => langFor(info) })`,
- the function form is preferable to the array form: it accepts an `LRLanguage` directly, it
  matches Lumir's existing `ALIASES`/`LANGUAGES` table shape (`src/preview/code.ts:113`), and it
  avoids the plain-object-does-nothing footgun,
- StreamLanguage legacy modes can be left in place as the fallback for languages without a
  Lezer parser (they are `Language` subclasses so they can also be returned from the function
  form, but they contribute no tree).
Two caveats: (a) nested trees need `resolveInner`-based traversal (§5.2.2);
(b) `@lezer/markdown` nested parsing is *incremental within CM6*, but the code-mode path parses
the code file as its own document — the two trees are separate objects; "one tree" means "one
pair of parsers", not literally one tree instance.

### 5.4 Language API references (for quoting)

`@codemirror/language/dist/index.d.ts`:
- `declare class Language {` — `:80`; `readonly data: Facet<…>` `:85`; `readonly name: string` `:91`;
  `readonly extension: Extension` `:95`; `parser: Parser` `:100`
  (doc: *"The parser object. Can be useful when using this as a nested parser"*);
  `get allowsNesting(): boolean` `:137`.
- `declare class LRLanguage extends Language` — `:143`; `readonly parser: LRParser` `:144`;
  `static define(spec: { name?: string; parser: LRParser; languageData?: {...} }): LRLanguage` `:149-167`
  (doc on `parser`: *"Should already have added editor-relevant node props (and optionally things
  like dialect and top rule) configured."*); `configure(options: ParserConfig, name?: string)` `:172`.
- `declare class LanguageSupport` — `:299`; `readonly language: Language` `:303`;
  `readonly support: Extension` `:310`; `constructor(language, support?)` `:320-331`.
- `indentNodeProp` `:558`, `foldNodeProp` `:666`, `defaultHighlightStyle` `:934`.
- `syntaxTree(state)` `:181`, `syntaxTreeAvailable(state, upto?)` `:197`.
- Language data lookup lives on state: `@codemirror/state/dist/index.d.ts:1274`
  `static languageData: Facet<(state, pos, side) => …>` and `:1295`
  `languageDataAt<T>(name: string, pos: number, side?): readonly T[]`.

Lumir today (`src/editor.ts:1025`, `:1156-1179`): `createEditor(..., markdownConfig:
{ base: markdownLanguage, extensions: [GFM] })`, and `modeExtensions()` does
`mode === "md" ? markdown(markdownConfig) : (codeLanguageFor(path) → StreamLanguage)`. The
`codeLanguages` hook is therefore currently **unset** — consistent with the note at
`src/preview/code.ts:1-5`. Wiring it means passing `codeLanguages` into the same `markdownConfig`
object (or into a new one built in `editor.ts`).

## 6. Recommended coverage set

Tier 1 — outline + binding highlight (real declaration nodes, clean decl/ref separation):
`javascript/ts (@lezer/javascript)`, `python`, `rust`, `go`, `c/cpp (@lezer/cpp)`, `java`,
`css`, `scss (@lezer/sass)`, `html`, `xml`, `json`, `toml`, `ruby`, `lua`, `swift`, `kotlin`.

Tier 2 — highlighting only, no outline:
`yaml` (highlight only; outline blocked by the §2.6 position bug),
`sql` (flat token parser; no declarations at all — highlight only, or keep legacy mode).

Tier 3 — no support:
`shell` (grammar errors on `local`/`$(( ))`/`function`; highlight-only at best),
`php` (currently `null` in Lumir; `@lezer/php` exists and is official if you want it).

Size of the Tier-1 + Tier-2 parser set, using the externals-measured numbers
(one bundle per parser, shared runtime counted once):

```
javascript 77751 + python 37959 + rust 83172 + go 27060 + cpp 103226 + java 39481
+ css 17205 + sass 22362 + html 12946 + xml 8627 + json 1705 + yaml 10759
+ ruby 85210 + toml 6534 + swift_fazel 63535 + kotlin 57826 + lua_fazel 25429
+ sql 32276
= parsers 723041 min / 277617 gzip
+ runtime (@lezer/lr + @lezer/common + highlight tags) 59350 min / 19533 gzip
= TOTAL ≈ 782 KB min / ≈ 297 KB gzip
```
(If `sql` stays on the existing StreamLanguage legacy mode, subtract 32 276 / 12 940.)
The single biggest contributors are `@lezer/cpp` (103 KB), `ruby` (85 KB), `rust` (83 KB) and
`javascript` (78 KB); `json` (1.7 KB) and `toml` (6.5 KB) are negligible.

## 7. Caveats / not verified

- Weekly download counts come from `https://api.npmjs.org/downloads/point/last-week/<pkg>`
  for the window 2026-09-15 → 2026-09-21; they are a proxy for adoption, not quality.
- `@fazelstudio/*` and `@codincod/*` are single-maintainer 2026 packages with 5–11 downloads
  per week. Their node grammars parsed my snippets cleanly (0 error nodes), but I did not test
  edge cases, incremental-reparse correctness, or long-term maintenance. "Dubious" here means
  "unproven, vendor risk", not "known broken".
- `@fig/lezer-bash` and `lezer-toml` are stale (2023 / 2022). `toml` passed all my probes;
  `bash` did not (documented failure matrix in §2.5).
- I did **not** verify that any of these parsers survive CM6 incremental re-parsing under
  edits (they are read-only code mode, so I did not test edit paths).
- The YAML position bug is empirically reproduced on `@lezer/yaml@1.0.4` and
  `@codemirror/lang-yaml@6.1.x`'s bundled grammar, but I could not confirm it against an
  upstream issue tracker (search returned only unrelated YAML parser issues).
- Parse times are single-process, cold-parser, Node V8 measurements on this machine; WKWebView
  (Lumir's real runtime) will differ, likely slower. Treat them as orders of magnitude, not as
  the contract number.
- Bundle sizes are esbuild 0.28.2 minified ESM with the stated externals; the total is a sum of
  independent single-parser bundles, which **overestimates** the real delta of adding all
  parsers to one bundle only in that shared helper code between grammars is not deduplicated
  here. The runtime figure was measured separately and added once.
