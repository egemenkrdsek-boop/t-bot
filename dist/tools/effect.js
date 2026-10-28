/**
 * Compatibility surface. The implementation moved to `core/tool-effect.ts`
 * because core phase/constraint gates own the classification and cannot import
 * from `tools`. Existing tool-layer consumers keep importing this module.
 */
export * from '../core/tool-effect.js';
//# sourceMappingURL=effect.js.map