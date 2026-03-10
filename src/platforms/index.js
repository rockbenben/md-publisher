/**
 * Platform registry — single import point for all platform modules.
 * Adding a new platform only requires: 1) create the module, 2) add export here.
 */
export { publish as sspai } from './sspai.js';
export { publish as zhihu } from './zhihu.js';
export { publish as wechat } from './wechat.js';
export { publish as smzdm } from './smzdm.js';
export { publish as juejin } from './juejin.js';
export { publish as x } from './x.js';
