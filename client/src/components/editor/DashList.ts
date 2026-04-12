import { BulletList } from '@tiptap/extension-bullet-list';
import { mergeAttributes } from '@tiptap/core';

/**
 * Extends TipTap's BulletList to support a `listStyle: 'dash'` attribute.
 *
 * Apple Notes exports use two distinct markers:
 *   "* text"  →  standard round bullet  (no extra attrs)
 *   "- text"  →  dash-style bullet      (attrs.listStyle = 'dash')
 *
 * Dash lists render as <ul class="dash-list"> and are styled via CSS with
 * list-style-type: "- " so they visually match the original Apple Notes export.
 *
 * Users can also create dash lists by typing "- " at the start of a line —
 * TipTap's built-in input rule handles this automatically via the parent class.
 */
export const DashBulletList = BulletList.extend({
  addAttributes() {
    return {
      listStyle: {
        default: null,
        parseHTML: el => el.classList.contains('dash-list') ? 'dash' : null,
        renderHTML: attrs => attrs.listStyle === 'dash' ? { class: 'dash-list' } : {},
      },
    };
  },

  renderHTML({ HTMLAttributes }) {
    return ['ul', mergeAttributes(HTMLAttributes), 0];
  },
});
