// Interaction constants
export const LONG_PRESS_DURATION = 500; // 500ms for long press

// Table geometry constants
export const TABLE_HEIGHT = 1.4;
export const TABLE_RADIUS = 1;
export const EDGE_TUBE_RADIUS = 0.03;

// Animation constants
export const ANIMATION_DURATION = 1; // 1 second max

// Drag constants
export const DRAG_MOVEMENT_THRESHOLD = 0.01; // Minimum movement to start dragging
export const DRAG_SENSITIVITY = 0.5; // Scale factor for drag sensitivity

// Label positioning constants
export const LABEL_BASE_OFFSET = 0.3;
export const LABEL_MAX_OFFSET = 0.8;
export const LABEL_Y_OFFSET = TABLE_HEIGHT / 2 + LABEL_BASE_OFFSET;

// Relationship line constants
export const RELATIONSHIP_LINE_Y_OFFSET = 0.1; // Offset for relationship lines above tables
export const CARDINALITY_OFFSET_DISTANCE = 0.8; // Distance from line ends for cardinality notation

// Cardinality notation constants
export const CARDINALITY_TORUS_RADIUS = 0.2;
export const CARDINALITY_TORUS_TUBE = 0.05;
export const CARDINALITY_PYRAMID_BASE_SIZE = 0.5;
export const CARDINALITY_PYRAMID_HEIGHT_MULTIPLIER = 2;

// Rendering scale constants
// Above this table count the scene switches from per-table meshes and
// per-relationship lines to instanced/batched rendering: one draw call per
// geometry bucket instead of several per table
export const LARGE_SCHEMA_THRESHOLD = 100;
// Max cylinder facet count for instanced tables (facets = column count is
// unreadable past this anyway, and fewer buckets means fewer draw calls)
export const INSTANCED_MAX_SEGMENTS = 32;
// Table labels are only rendered near the camera on large schemas
export const LABEL_VISIBILITY_DISTANCE = 22;
export const LABEL_MAX_COUNT = 120;
