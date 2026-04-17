import { Note } from '../api/notes';

let _idSeq = 0;
export function genId(): string {
  return `q${++_idSeq}_${Math.random().toString(36).slice(2, 6)}`;
}

export type ConditionField =
  | 'contains'
  | 'tag'
  | 'before'
  | 'after'
  | 'created_before'
  | 'created_after'
  | 'archived'
  | 'private'
  | 'pinned';

export interface FieldDef {
  label: string;
  inputType: 'text' | 'date' | 'none';
  placeholder?: string;
}

export const FIELD_DEFS: Record<ConditionField, FieldDef> = {
  contains:       { label: 'contains',        inputType: 'text', placeholder: 'text…' },
  tag:            { label: 'tag',             inputType: 'text', placeholder: 'tag name' },
  before:         { label: 'updated before',  inputType: 'date' },
  after:          { label: 'updated after',   inputType: 'date' },
  created_before: { label: 'created before',  inputType: 'date' },
  created_after:  { label: 'created after',   inputType: 'date' },
  archived:       { label: 'archived',        inputType: 'none' },
  private:        { label: 'private',         inputType: 'none' },
  pinned:         { label: 'pinned',          inputType: 'none' },
};

export const ALL_FIELDS = Object.keys(FIELD_DEFS) as ConditionField[];

export interface QueryCondition {
  type: 'condition';
  id: string;
  field: ConditionField;
  negated: boolean;
  value?: string;
}

export interface QueryGroup {
  type: 'group';
  id: string;
  op: 'AND' | 'OR';
  negated: boolean;
  children: QueryNode[];
}

export type QueryNode = QueryCondition | QueryGroup;

export function emptyGroup(): QueryGroup {
  return { type: 'group', id: genId(), op: 'AND', negated: false, children: [] };
}

export function newCondition(field: ConditionField): QueryCondition {
  return { type: 'condition', id: genId(), field, negated: false, value: undefined };
}

export function isQueryEmpty(g: QueryGroup): boolean {
  return g.children.length === 0;
}

// ── Immutable tree helpers ──────────────────────────────────────────────────

export function updateInTree(
  root: QueryGroup,
  id: string,
  updater: (n: QueryNode) => QueryNode,
): QueryGroup {
  function walk(node: QueryNode): QueryNode {
    if (node.id === id) return updater(node);
    if (node.type === 'group') return { ...node, children: node.children.map(walk) };
    return node;
  }
  return walk(root) as QueryGroup;
}

export function removeFromTree(root: QueryGroup, id: string): QueryGroup {
  function walk(node: QueryNode): QueryNode {
    if (node.type === 'group')
      return { ...node, children: node.children.filter(c => c.id !== id).map(walk) };
    return node;
  }
  return walk(root) as QueryGroup;
}

export function addToGroup(root: QueryGroup, groupId: string, child: QueryNode): QueryGroup {
  return updateInTree(root, groupId, node => {
    if (node.type !== 'group') return node;
    return { ...node, children: [...node.children, child] };
  });
}

// ── Serializer ──────────────────────────────────────────────────────────────

export function serializeQuery(node: QueryNode, parentOp?: 'AND' | 'OR'): string {
  if (node.type === 'condition') {
    const prefix = node.negated ? 'NOT ' : '';
    if (FIELD_DEFS[node.field].inputType === 'none') return prefix + node.field;
    const v = node.value ?? '';
    const quoted = /\s/.test(v) ? `"${v}"` : v;
    return `${prefix}${node.field}:${quoted}`;
  }

  if (node.children.length === 0) return '';
  if (node.children.length === 1) {
    const inner = serializeQuery(node.children[0], node.op);
    return node.negated ? `NOT (${inner})` : inner;
  }

  const parts = node.children.map(c => serializeQuery(c, node.op)).join(` ${node.op} `);
  const prefix = node.negated ? 'NOT ' : '';
  const needsParens = node.negated || (parentOp !== undefined && parentOp !== node.op);
  return needsParens ? `${prefix}(${parts})` : prefix + parts;
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

type Token =
  | { type: 'AND' }
  | { type: 'OR' }
  | { type: 'NOT' }
  | { type: 'LPAREN' }
  | { type: 'RPAREN' }
  | { type: 'COND'; field: ConditionField; value: string }
  | { type: 'FLAG'; name: ConditionField }
  | { type: 'EOF' };

const FLAG_SET = new Set<string>(['archived', 'private', 'pinned']);
const FIELD_SET = new Set<string>([
  'contains', 'tag', 'before', 'after', 'created_before', 'created_after',
]);

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;

  while (i < src.length) {
    if (/\s/.test(src[i])) { i++; continue; }
    if (src[i] === '(') { out.push({ type: 'LPAREN' }); i++; continue; }
    if (src[i] === ')') { out.push({ type: 'RPAREN' }); i++; continue; }

    let j = i;
    while (j < src.length && !/[\s():]/.test(src[j])) j++;
    const word = src.slice(i, j);
    if (!word) { i++; continue; }

    const upper = word.toUpperCase();
    if (upper === 'AND') { out.push({ type: 'AND' }); i = j; continue; }
    if (upper === 'OR')  { out.push({ type: 'OR' });  i = j; continue; }
    if (upper === 'NOT') { out.push({ type: 'NOT' }); i = j; continue; }

    const lower = word.toLowerCase();

    if (j < src.length && src[j] === ':' && FIELD_SET.has(lower)) {
      i = j + 1;
      let value = '';
      if (i < src.length && src[i] === '"') {
        i++;
        while (i < src.length && src[i] !== '"') { value += src[i]; i++; }
        if (i < src.length) i++;
      } else {
        let k = i;
        while (k < src.length && !/[\s()]/.test(src[k])) k++;
        value = src.slice(i, k);
        i = k;
      }
      out.push({ type: 'COND', field: lower as ConditionField, value });
      continue;
    }

    if (FLAG_SET.has(lower)) {
      out.push({ type: 'FLAG', name: lower as ConditionField });
    } else {
      out.push({ type: 'COND', field: 'contains', value: word });
    }
    i = j;
  }

  out.push({ type: 'EOF' });
  return out;
}

// ── Parser ──────────────────────────────────────────────────────────────────

export function parseQuery(input: string): QueryGroup {
  if (!input.trim()) return emptyGroup();

  const tokens = tokenize(input);
  let pos = 0;

  const peek = (): Token => tokens[pos] ?? { type: 'EOF' };
  const consume = (): Token => tokens[pos++] ?? { type: 'EOF' };

  const isAtomStart = (): boolean => {
    const t = peek().type;
    return t === 'LPAREN' || t === 'COND' || t === 'FLAG' || t === 'NOT';
  };

  function parseOr(): QueryNode {
    const children: QueryNode[] = [parseAnd()];
    while (peek().type === 'OR') { consume(); children.push(parseAnd()); }
    if (children.length === 1) return children[0];
    return { type: 'group', id: genId(), op: 'OR', negated: false, children };
  }

  function parseAnd(): QueryNode {
    const children: QueryNode[] = [parseNot()];
    while (
      peek().type === 'AND' ||
      (peek().type !== 'OR' && peek().type !== 'RPAREN' && peek().type !== 'EOF' && isAtomStart())
    ) {
      if (peek().type === 'AND') consume();
      if (!isAtomStart()) break;
      children.push(parseNot());
    }
    if (children.length === 1) return children[0];
    return { type: 'group', id: genId(), op: 'AND', negated: false, children };
  }

  function parseNot(): QueryNode {
    if (peek().type === 'NOT') {
      consume();
      const atom = parseAtom();
      return { ...atom, negated: !atom.negated };
    }
    return parseAtom();
  }

  function parseAtom(): QueryNode {
    const tok = peek();

    if (tok.type === 'LPAREN') {
      consume();
      const expr = parseOr();
      if (peek().type === 'RPAREN') consume();
      return expr;
    }
    if (tok.type === 'COND') {
      consume();
      return { type: 'condition', id: genId(), field: tok.field, negated: false, value: tok.value };
    }
    if (tok.type === 'FLAG') {
      consume();
      return { type: 'condition', id: genId(), field: tok.name, negated: false };
    }
    consume();
    return emptyGroup();
  }

  const result = parseOr();
  if (result.type === 'group') return result;
  return { type: 'group', id: genId(), op: 'AND', negated: false, children: [result] };
}

// ── Evaluator ───────────────────────────────────────────────────────────────

function dateToUnix(s: string): number {
  if (!s) return 0;
  const t = new Date(s).getTime();
  return isNaN(t) ? 0 : Math.floor(t / 1000);
}

export function evaluateQuery(group: QueryGroup, note: Note): boolean {
  return evalNode(group, note);
}

function evalNode(node: QueryNode, note: Note): boolean {
  let result: boolean;
  if (node.type === 'group') {
    if (node.children.length === 0) return true;
    result = node.op === 'AND'
      ? node.children.every(c => evalNode(c, note))
      : node.children.some(c => evalNode(c, note));
  } else {
    result = evalCond(node, note);
  }
  return node.negated ? !result : result;
}

function evalCond(c: QueryCondition, note: Note): boolean {
  const title = (note.title ?? '').toLowerCase();
  const body  = (note.body_text ?? '').toLowerCase();
  const v = c.value ?? '';

  switch (c.field) {
    case 'contains':      return title.includes(v.toLowerCase()) || body.includes(v.toLowerCase());
    case 'tag':           return note.tags.some(t => t.toLowerCase() === v.toLowerCase());
    case 'before':        return !!v && note.updated_at < dateToUnix(v);
    case 'after':         return !!v && note.updated_at > dateToUnix(v);
    case 'created_before':return !!v && note.created_at < dateToUnix(v);
    case 'created_after': return !!v && note.created_at > dateToUnix(v);
    case 'archived':      return !!note.archived;
    case 'private':       return !!note.private;
    case 'pinned':        return !!note.pinned;
    default:              return true;
  }
}
