/**
 * This app's render context: interlocking's generic one, bound to this app's
 * page-state union and its own session class.
 *
 * Aliased in one place so every page keeps writing `RenderContext`
 * unparameterized, and so `ctx.session` stays the full session rather than the
 * four-member view the shared renderers are written against.
 */

import type { RenderContext as SharedRenderContext } from 'interlocking/gtfs/entity-render';
import type { PageState } from '../types/page-state';
import type { FeedSession } from './feed-session';

export type RenderContext = SharedRenderContext<PageState, FeedSession>;
