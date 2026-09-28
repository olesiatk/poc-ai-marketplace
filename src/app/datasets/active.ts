import { BEAUTY_DATASET } from "./beauty";
import type { DatasetConfig } from "./dataset.model";

/**
 * The one catalog this build of the app uses. To switch catalogs, point this
 * at another config (e.g. `HEALTH_DATASET` from "./health") — nothing else
 * in the app needs to change.
 */
export const ACTIVE_DATASET: DatasetConfig = BEAUTY_DATASET;
