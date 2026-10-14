// Screens and hooks must not read a value before the line that creates it. Inside a component this compiles fine but
// crashes the screen ("Cannot access … before initialization") — and only when the data takes that path, so it can
// pass every sample and still break a real business. This walks every component and hook body (functions named
// Capitalised or use…) and flags a read of a later const/let that runs right away: directly, in an immediate
// array callback (.filter/.map/…), in an immediately called function, or in useMemo.
// Run: npx tsx scripts/verify/use-before-define.verify.ts
import ts from 'typescript';
import fs from 'fs';
import path from 'path';

const IMMEDIATE = new Set(['filter', 'map', 'find', 'some', 'every', 'reduce', 'forEach', 'flatMap', 'sort', 'findIndex', 'findLast']);
const files: string[] = [];
const walk = (d: string) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else if (/\.tsx?$/.test(f) && !f.endsWith('.d.ts')) files.push(p); } };
walk('src/components'); walk('src/app'); walk('src/hooks');

const problems: string[] = [];
for (const file of files) {
  const text = fs.readFileSync(file, 'utf8');
  if (!/use[A-Z]|<[A-Z]/.test(text)) continue;
  const src = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, file.endsWith('x') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const bodies: ts.Block[] = [];
  const isComp = (n?: string) => !!n && (/^[A-Z]/.test(n) || /^use[A-Z]/.test(n));
  const find = (n: ts.Node) => {
    if (ts.isFunctionDeclaration(n) && isComp(n.name?.text) && n.body) bodies.push(n.body);
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && isComp(n.name.text) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)) && n.initializer.body && ts.isBlock(n.initializer.body)) bodies.push(n.initializer.body);
    ts.forEachChild(n, find);
  };
  find(src);
  for (const body of bodies) {
    const stmts = body.statements; const declAt = new Map<string, number>();
    stmts.forEach((s, i) => { if (ts.isVariableStatement(s)) s.declarationList.declarations.forEach((d) => { const add = (b: ts.BindingName) => { if (ts.isIdentifier(b)) declAt.set(b.text, i); else (b as any).elements?.forEach((el: any) => el.name && add(el.name)); }; add(d.name); }); });
    const params = (fn: ts.Node): Set<string> => { const out = new Set<string>(); (fn as any).parameters?.forEach((p: any) => { const add = (b: any) => { if (ts.isIdentifier(b)) out.add(b.text); else b.elements?.forEach((el: any) => el.name && add(el.name)); }; add(p.name); }); return out; };
    stmts.forEach((s, i) => {
      if (ts.isReturnStatement(s)) return;
      // Names created inside this statement's own nested blocks are local to it, not the later top-level ones.
      const local = new Set<string>();
      const collect = (n: ts.Node, top: boolean) => { if (!top && ts.isVariableDeclaration(n)) { const add = (b: any) => { if (ts.isIdentifier(b)) local.add(b.text); else b.elements?.forEach((el: any) => el.name && add(el.name)); }; add(n.name); } ts.forEachChild(n, (c) => collect(c, top && !ts.isBlock(c) && !ts.isArrowFunction(c) && !ts.isFunctionExpression(c))); };
      collect(s, true);
      const visit = (n: ts.Node, deferred: boolean, shadow: Set<string>) => {
        if (ts.isTypeNode(n) || ts.isTypeAliasDeclaration(n) || ts.isInterfaceDeclaration(n)) return;
        if (ts.isArrowFunction(n) || ts.isFunctionExpression(n) || ts.isFunctionDeclaration(n)) {
          const p = n.parent; let imm = false;
          if (ts.isCallExpression(p) && p.arguments.includes(n as any) && ts.isPropertyAccessExpression(p.expression) && IMMEDIATE.has(p.expression.name.text)) imm = true;
          if (ts.isParenthesizedExpression(p) && ts.isCallExpression(p.parent) && p.parent.expression === p) imm = true;
          if (ts.isCallExpression(p) && p.arguments.includes(n as any) && ts.isIdentifier(p.expression) && p.expression.text === 'useMemo') imm = true;
          const sh = new Set([...shadow, ...params(n)]);
          ts.forEachChild(n, (c) => visit(c, deferred || !imm, sh)); return;
        }
        if (!deferred && ts.isIdentifier(n) && !shadow.has(n.text) && (declAt.get(n.text) ?? -1) > i
          && !(ts.isPropertyAccessExpression(n.parent) && n.parent.name === n) && !(ts.isPropertyAssignment(n.parent) && n.parent.name === n)
          && !(ts.isBindingElement(n.parent)) && !(ts.isVariableDeclaration(n.parent) && n.parent.name === n) && !ts.isJsxAttribute(n.parent) && !((ts.isJsxOpeningElement(n.parent) || ts.isJsxSelfClosingElement(n.parent) || ts.isJsxClosingElement(n.parent)) && (n.parent as any).tagName === n) && !(ts.isShorthandPropertyAssignment(n.parent) && false)) {
          const { line } = src.getLineAndCharacterOfPosition(n.getStart());
          problems.push(`${file}:${line + 1} reads '${n.text}' before it is created`);
        }
        ts.forEachChild(n, (c) => visit(c, deferred, shadow));
      };
      visit(s, false, local);
    });
  }
}
const uniq = [...new Set(problems)];
for (const p of uniq) console.log('✗', p);
console.log(uniq.length ? `${uniq.length} read(s) before creation` : '✓ no component reads a value before it is created');
process.exit(uniq.length ? 1 : 0);
