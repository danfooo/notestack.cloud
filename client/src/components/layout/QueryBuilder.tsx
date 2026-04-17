import React, { useState, useEffect, useRef } from 'react';
import {
  QueryGroup, QueryNode, QueryCondition, ConditionField,
  FIELD_DEFS, ALL_FIELDS, parseQuery, serializeQuery,
  emptyGroup, newCondition, isQueryEmpty,
  updateInTree, removeFromTree, addToGroup, genId,
} from '../../lib/noteQuery';

interface Props {
  value: QueryGroup;
  onChange: (v: QueryGroup) => void;
}

export function QueryBuilder({ value, onChange }: Props) {
  const [text, setText] = useState(() => serializeQuery(value));
  const [treeOpen, setTreeOpen] = useState(true);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) setText(serializeQuery(value));
  }, [value]);

  const commitText = () => {
    focused.current = false;
    const parsed = parseQuery(text);
    onChange(parsed);
    // Normalize text to canonical form after parse
    setText(serializeQuery(parsed));
  };

  const handleTreeChange = (next: QueryGroup) => {
    setText(serializeQuery(next));
    onChange(next);
  };

  const clear = () => {
    const empty = emptyGroup();
    setText('');
    onChange(empty);
  };

  const hasQuery = !isQueryEmpty(value);
  const conditionCount = countConditions(value);

  return (
    <div className="space-y-1.5">
      {/* Text row */}
      <div className="flex items-center gap-1">
        <input
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          onFocus={() => { focused.current = true; }}
          onBlur={commitText}
          onKeyDown={e => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder="Filter: before:2025-01-01, tag:work, contains:…"
          spellCheck={false}
          className="flex-1 min-w-0 px-2.5 py-1.5 text-xs font-mono bg-white border border-gray-200 rounded-lg outline-none focus:border-amber-400 focus:ring-1 focus:ring-amber-400 placeholder-gray-400"
        />
        {hasQuery && (
          <>
            <button
              onClick={() => setTreeOpen(o => !o)}
              title={treeOpen ? 'Hide tree' : 'Show tree'}
              className="text-gray-400 hover:text-gray-600 px-1.5 py-1.5 rounded transition-colors text-xs"
            >
              {treeOpen ? '▾' : '▸'}
            </button>
            <button
              onClick={clear}
              title="Clear filter"
              className="text-gray-300 hover:text-red-400 px-1.5 py-1.5 rounded transition-colors text-sm leading-none"
            >
              ×
            </button>
          </>
        )}
      </div>

      {/* Visual tree */}
      {hasQuery && treeOpen && (
        <GroupEditor
          group={value}
          root={value}
          isRoot
          onRootChange={handleTreeChange}
          onRemoveSelf={() => {}}
        />
      )}

      {/* Empty state: quick-start pills */}
      {!hasQuery && (
        <div className="flex flex-wrap gap-1">
          {(['before', 'contains', 'tag', 'archived', 'private'] as ConditionField[]).map(f => (
            <button
              key={f}
              onClick={() => handleTreeChange(addToGroup(value, value.id, newCondition(f)))}
              className="text-xs text-gray-400 hover:text-amber-600 px-2 py-0.5 rounded-full border border-dashed border-gray-200 hover:border-amber-400 transition-colors"
            >
              {FIELD_DEFS[f].label}
            </button>
          ))}
        </div>
      )}

      {hasQuery && (
        <div className="text-xs text-gray-400 px-0.5">
          {conditionCount} condition{conditionCount !== 1 ? 's' : ''}
        </div>
      )}
    </div>
  );
}

function countConditions(node: QueryNode): number {
  if (node.type === 'condition') return 1;
  return node.children.reduce((n, c) => n + countConditions(c), 0);
}

// ── GroupEditor ─────────────────────────────────────────────────────────────

interface GroupEditorProps {
  group: QueryGroup;
  root: QueryGroup;
  isRoot: boolean;
  onRootChange: (r: QueryGroup) => void;
  onRemoveSelf: () => void;
}

function GroupEditor({ group, root, isRoot, onRootChange, onRemoveSelf }: GroupEditorProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const h = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, [menuOpen]);

  const toggleOp = () =>
    onRootChange(
      updateInTree(root, group.id, n => ({
        ...n,
        op: (n as QueryGroup).op === 'AND' ? 'OR' : 'AND',
      })),
    );

  const toggleNegated = () =>
    onRootChange(updateInTree(root, group.id, n => ({ ...n, negated: !n.negated })));

  const addField = (f: ConditionField) => {
    onRootChange(addToGroup(root, group.id, newCondition(f)));
    setMenuOpen(false);
  };

  const addSubgroup = () => {
    const sub: QueryGroup = { type: 'group', id: genId(), op: 'OR', negated: false, children: [] };
    onRootChange(addToGroup(root, group.id, sub));
    setMenuOpen(false);
  };

  const removeChild = (id: string) => onRootChange(removeFromTree(root, id));

  const updateChild = (id: string, updates: Partial<QueryCondition>) =>
    onRootChange(updateInTree(root, id, n => ({ ...n, ...updates } as QueryNode)));

  return (
    <div
      className={`rounded-lg border p-2 space-y-1 ${
        isRoot ? 'border-gray-200 bg-gray-50' : 'border-gray-200 bg-white shadow-sm'
      }`}
    >
      {/* Header */}
      <div className="flex items-center gap-1.5 flex-wrap">
        {!isRoot && (
          <button
            onClick={toggleNegated}
            className={`text-xs px-1.5 py-0.5 rounded transition-colors ${
              group.negated ? 'bg-red-100 text-red-600 font-medium' : 'text-gray-300 hover:text-gray-500'
            }`}
            title="Toggle NOT"
          >
            NOT
          </button>
        )}
        <button
          onClick={toggleOp}
          className={`text-xs font-semibold px-2 py-0.5 rounded transition-colors ${
            group.op === 'AND'
              ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
              : 'bg-orange-100 text-orange-700 hover:bg-orange-200'
          }`}
          title="Click to toggle AND/OR"
        >
          {group.op}
        </button>
        <span className="text-xs text-gray-400 flex-1 hidden sm:inline">
          {group.op === 'AND' ? 'all must match' : 'any must match'}
        </span>
        {!isRoot && (
          <button
            onClick={onRemoveSelf}
            className="text-xs text-gray-300 hover:text-red-400 transition-colors ml-auto"
          >
            remove group
          </button>
        )}
      </div>

      {/* Children */}
      <div className="space-y-1 pl-1">
        {group.children.map(child =>
          child.type === 'condition' ? (
            <ConditionEditor
              key={child.id}
              condition={child}
              onUpdate={updates => updateChild(child.id, updates)}
              onRemove={() => removeChild(child.id)}
            />
          ) : (
            <GroupEditor
              key={child.id}
              group={child}
              root={root}
              isRoot={false}
              onRootChange={onRootChange}
              onRemoveSelf={() => removeChild(child.id)}
            />
          ),
        )}
      </div>

      {/* Add menu */}
      <div ref={menuRef} className="relative">
        <button
          onClick={() => setMenuOpen(o => !o)}
          className="text-xs text-gray-400 hover:text-amber-600 px-2 py-0.5 rounded-full border border-dashed border-gray-200 hover:border-amber-400 transition-colors"
        >
          + add
        </button>
        {menuOpen && (
          <div className="absolute left-0 top-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg p-1 z-50 min-w-[180px]">
            {ALL_FIELDS.map(f => (
              <button
                key={f}
                onClick={() => addField(f)}
                className="w-full text-left text-xs px-2.5 py-1.5 hover:bg-amber-50 rounded transition-colors text-gray-700"
              >
                {FIELD_DEFS[f].label}
              </button>
            ))}
            <div className="border-t border-gray-100 mt-1 pt-1">
              <button
                onClick={addSubgroup}
                className="w-full text-left text-xs px-2.5 py-1.5 hover:bg-blue-50 rounded transition-colors text-blue-600 font-medium"
              >
                + add group
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── ConditionEditor ─────────────────────────────────────────────────────────

interface ConditionEditorProps {
  condition: QueryCondition;
  onUpdate: (updates: Partial<QueryCondition>) => void;
  onRemove: () => void;
}

function ConditionEditor({ condition, onUpdate, onRemove }: ConditionEditorProps) {
  const def = FIELD_DEFS[condition.field];

  return (
    <div className="flex items-center gap-1 group/cond rounded px-1 py-0.5 hover:bg-gray-50 transition-colors">
      <button
        onClick={() => onUpdate({ negated: !condition.negated })}
        title="Toggle NOT"
        className={`text-xs px-1.5 py-0.5 rounded flex-shrink-0 transition-colors ${
          condition.negated
            ? 'bg-red-100 text-red-600 font-medium'
            : 'text-gray-200 hover:text-gray-400'
        }`}
      >
        NOT
      </button>

      <select
        value={condition.field}
        onChange={e => {
          const f = e.target.value as ConditionField;
          onUpdate({
            field: f,
            value: FIELD_DEFS[f].inputType === 'none' ? undefined : condition.value,
          });
        }}
        className="text-xs border border-gray-200 rounded px-1.5 py-0.5 bg-white outline-none focus:border-amber-400 flex-shrink-0 max-w-[120px]"
      >
        {ALL_FIELDS.map(f => (
          <option key={f} value={f}>{FIELD_DEFS[f].label}</option>
        ))}
      </select>

      {def.inputType === 'text' && (
        <input
          type="text"
          value={condition.value ?? ''}
          onChange={e => onUpdate({ value: e.target.value })}
          placeholder={def.placeholder ?? ''}
          className="flex-1 min-w-0 text-xs border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:border-amber-400 bg-white"
        />
      )}
      {def.inputType === 'date' && (
        <input
          type="date"
          value={condition.value ?? ''}
          onChange={e => onUpdate({ value: e.target.value })}
          className="text-xs border border-gray-200 rounded px-1.5 py-0.5 outline-none focus:border-amber-400 bg-white"
        />
      )}
      {def.inputType === 'none' && (
        <span className="flex-1 text-xs text-gray-400 italic">is set</span>
      )}

      <button
        onClick={onRemove}
        className="opacity-0 group-hover/cond:opacity-100 text-gray-300 hover:text-red-400 transition-all text-sm leading-none flex-shrink-0 ml-auto pl-1"
      >
        ×
      </button>
    </div>
  );
}
