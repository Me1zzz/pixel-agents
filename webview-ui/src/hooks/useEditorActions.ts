import { useCallback, useRef, useState } from 'react';

import type { ColorValue } from '../components/ui/types.js';
import { LAYOUT_SAVE_DEBOUNCE_MS, ZOOM_MAX, ZOOM_MIN } from '../constants.js';
import type { ExpandDirection } from '../office/editor/editorActions.js';
import {
  canPlaceFurniture,
  expandLayout,
  getWallPlacementRow,
  moveFurniture,
  paintTile,
  placeFurniture,
  removeFurniture,
  rotateFurniture,
  toggleFurnitureState,
} from '../office/editor/editorActions.js';
import type { EditorState } from '../office/editor/editorState.js';
import { EditorState as EditorStateImpl } from '../office/editor/editorState.js';
import type { OfficeState } from '../office/engine/officeState.js';
import {
  getCatalogEntry,
  getRotatedType,
  getToggledType,
} from '../office/layout/furnitureCatalog.js';
import { defaultZoom } from '../office/toolUtils.js';
import type {
  EditTool as EditToolType,
  OfficeLayout,
  PlacedFurniture,
  TileType as TileTypeVal,
} from '../office/types.js';
import { EditTool } from '../office/types.js';
import { TileType } from '../office/types.js';
import { DEFAULT_OFFICE_ID, resolveOfficeId } from '../offices/officeStore.js';
import { vscode } from '../vscodeApi.js';

interface EditorOfficeContext {
  officeId: string;
  officeState: OfficeState;
}

export function resolveEditorOfficeContext(
  getActiveOfficeId: () => string | undefined,
  getOfficeState: (officeId?: string) => OfficeState,
): EditorOfficeContext {
  const officeId = resolveOfficeId(getActiveOfficeId() ?? DEFAULT_OFFICE_ID);
  return {
    officeId,
    officeState: getOfficeState(officeId),
  };
}

export function buildSaveLayoutMessage(
  officeId: string,
  layout: OfficeLayout,
): {
  type: 'saveLayout';
  officeId: string;
  layout: OfficeLayout;
} {
  return {
    type: 'saveLayout',
    officeId,
    layout,
  };
}

export function createLayoutCheckpointStore(): {
  get: (officeId: string) => OfficeLayout | null;
  set: (officeId: string, layout: OfficeLayout) => void;
} {
  const checkpoints = new Map<string, OfficeLayout>();
  return {
    get: (officeId: string) => checkpoints.get(officeId) ?? null,
    set: (officeId: string, layout: OfficeLayout) => {
      checkpoints.set(officeId, structuredClone(layout));
    },
  };
}

export interface EditorSessionState {
  editorState: EditorState;
  isEditMode: boolean;
  isDirty: boolean;
  zoom: number;
  pan: { x: number; y: number };
  saveTimer: ReturnType<typeof setTimeout> | null;
  checkpoints: ReturnType<typeof createLayoutCheckpointStore>;
}

export function createEditorSessionStore(): {
  get: (officeId: string) => EditorSessionState;
};
export function createEditorSessionStore(getDefaultZoom: () => number): {
  get: (officeId: string) => EditorSessionState;
};
export function createEditorSessionStore(getDefaultZoom: () => number = defaultZoom): {
  get: (officeId: string) => EditorSessionState;
} {
  const sessions = new Map<string, EditorSessionState>();

  return {
    get: (officeId: string) => {
      const existing = sessions.get(officeId);
      if (existing) {
        return existing;
      }

      const created: EditorSessionState = {
        editorState: new EditorStateImpl(),
        isEditMode: false,
        isDirty: false,
        zoom: getDefaultZoom(),
        pan: { x: 0, y: 0 },
        saveTimer: null,
        checkpoints: createLayoutCheckpointStore(),
      };
      sessions.set(officeId, created);
      return created;
    },
  };
}

interface EditorActions {
  isEditMode: boolean;
  editorTick: number;
  isDirty: boolean;
  zoom: number;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
  saveTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
  setLastSavedLayout: (officeId: string, layout: OfficeLayout) => void;
  handleOpenClaude: () => void;
  handleToggleEditMode: () => void;
  handleToolChange: (tool: EditToolType) => void;
  handleTileTypeChange: (type: TileTypeVal) => void;
  handleFloorColorChange: (color: ColorValue) => void;
  handleWallColorChange: (color: ColorValue) => void;
  handleWallSetChange: (setIndex: number) => void;
  handleSelectedFurnitureColorChange: (color: ColorValue | null) => void;
  handleFurnitureTypeChange: (type: string) => void; // FurnitureType enum or asset ID
  handleDeleteSelected: () => void;
  handleRotateSelected: () => void;
  handleToggleState: () => void;
  handleUndo: () => void;
  handleRedo: () => void;
  handleReset: () => void;
  handleSave: () => void;
  handleZoomChange: (zoom: number) => void;
  handleEditorTileAction: (col: number, row: number) => void;
  handleEditorEraseAction: (col: number, row: number) => void;
  handleEditorSelectionChange: () => void;
  handleDragMove: (uid: string, newCol: number, newRow: number) => void;
}

export function useEditorActions(
  getActiveOfficeId: () => string | undefined,
  getOfficeState: (officeId?: string) => OfficeState,
  editorSession: EditorSessionState,
): EditorActions {
  const [editorTick, setEditorTick] = useState(0);
  const editorState = editorSession.editorState;
  const panRef = useRef(editorSession.pan);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(editorSession.saveTimer);

  const setSessionDirty = useCallback(
    (dirty: boolean) => {
      editorSession.isDirty = dirty;
    },
    [editorSession],
  );

  const setSessionEditMode = useCallback(
    (isEditMode: boolean) => {
      editorSession.isEditMode = isEditMode;
    },
    [editorSession],
  );

  const setSessionZoom = useCallback(
    (zoom: number) => {
      editorSession.zoom = zoom;
    },
    [editorSession],
  );

  const syncSaveTimer = useCallback(
    (timer: ReturnType<typeof setTimeout> | null) => {
      saveTimerRef.current = timer;
      editorSession.saveTimer = timer;
    },
    [editorSession],
  );

  // Called by useExtensionMessages on layoutLoaded to set the initial checkpoint
  const setLastSavedLayout = useCallback(
    (officeId: string, layout: OfficeLayout) => {
      editorSession.checkpoints.set(officeId, layout);
    },
    [editorSession],
  );

  const getCurrentOfficeContext = useCallback(
    () => resolveEditorOfficeContext(getActiveOfficeId, getOfficeState),
    [getActiveOfficeId, getOfficeState],
  );

  // Debounced layout save
  const saveLayout = useCallback(
    (officeId: string, layout: OfficeLayout) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      syncSaveTimer(
        setTimeout(() => {
          vscode.postMessage(buildSaveLayoutMessage(officeId, layout));
        }, LAYOUT_SAVE_DEBOUNCE_MS),
      );
    },
    [syncSaveTimer],
  );

  // Apply a layout edit: push undo, clear redo, rebuild state, save, mark dirty
  const applyEdit = useCallback(
    (newLayout: OfficeLayout) => {
      const { officeId, officeState } = getCurrentOfficeContext();
      editorState.pushUndo(officeState.getLayout());
      editorState.clearRedo();
      editorState.isDirty = true;
      setSessionDirty(true);
      officeState.rebuildFromLayout(newLayout);
      saveLayout(officeId, newLayout);
      setEditorTick((n) => n + 1);
    },
    [getCurrentOfficeContext, editorState, saveLayout, setSessionDirty],
  );

  const handleOpenClaude = useCallback(() => {
    vscode.postMessage({ type: 'openClaude' });
  }, []);

  const handleToggleEditMode = useCallback(() => {
    setSessionEditMode(!editorSession.isEditMode);
    const next = !editorSession.isEditMode;
    editorState.isEditMode = next;
    if (next) {
      // Initialize wallColor from existing wall tiles so new walls match
      const { officeState } = getCurrentOfficeContext();
      const layout = officeState.getLayout();
      if (layout.tileColors) {
        for (let i = 0; i < layout.tiles.length; i++) {
          if (layout.tiles[i] === TileType.WALL && layout.tileColors[i]) {
            editorState.wallColor = { ...layout.tileColors[i]! };
            break;
          }
        }
      }
    } else {
      editorState.clearSelection();
      editorState.clearGhost();
      editorState.clearDrag();
      wallColorEditActiveRef.current = false;
    }
  }, [editorSession.isEditMode, editorState, getCurrentOfficeContext, setSessionEditMode]);

  // Tool toggle: clicking already-active tool deselects it (returns to SELECT)
  const handleToolChange = useCallback(
    (tool: EditToolType) => {
      if (editorState.activeTool === tool) {
        editorState.activeTool = EditTool.SELECT;
      } else {
        editorState.activeTool = tool;
      }
      editorState.clearSelection();
      editorState.clearGhost();
      editorState.clearDrag();
      colorEditUidRef.current = null;
      wallColorEditActiveRef.current = false;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleTileTypeChange = useCallback(
    (type: TileTypeVal) => {
      editorState.selectedTileType = type;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleFloorColorChange = useCallback(
    (color: ColorValue) => {
      editorState.floorColor = color;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // Track whether we've already pushed undo for the current wall color editing session
  const wallColorEditActiveRef = useRef(false);

  const handleWallColorChange = useCallback(
    (color: ColorValue) => {
      editorState.wallColor = color;

      // Update all existing wall tiles to the new color
      const { officeId, officeState } = getCurrentOfficeContext();
      const layout = officeState.getLayout();
      const existingColors = layout.tileColors || new Array(layout.tiles.length).fill(null);
      const newColors = [...existingColors];
      let changed = false;
      for (let i = 0; i < layout.tiles.length; i++) {
        if (layout.tiles[i] === TileType.WALL) {
          newColors[i] = { ...color };
          changed = true;
        }
      }
      if (changed) {
        // Push undo only once per editing session (first slider touch)
        if (!wallColorEditActiveRef.current) {
          editorState.pushUndo(layout);
          editorState.clearRedo();
          wallColorEditActiveRef.current = true;
        }
        const newLayout = { ...layout, tileColors: newColors };
        editorState.isDirty = true;
        setSessionDirty(true);
        officeState.rebuildFromLayout(newLayout);
        saveLayout(officeId, newLayout);
      }
      setEditorTick((n) => n + 1);
    },
    [editorState, getCurrentOfficeContext, saveLayout, setSessionDirty],
  );

  const handleWallSetChange = useCallback(
    (setIndex: number) => {
      editorState.selectedWallSet = setIndex;
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  // Track which uid we've already pushed undo for during color editing
  // so dragging sliders doesn't create N undo entries
  const colorEditUidRef = useRef<string | null>(null);

  const handleSelectedFurnitureColorChange = useCallback(
    (color: ColorValue | null) => {
      const uid = editorState.selectedFurnitureUid;
      if (!uid) return;
      const { officeId, officeState } = getCurrentOfficeContext();
      const layout = officeState.getLayout();

      // Push undo only once per selection (first slider touch)
      if (colorEditUidRef.current !== uid) {
        editorState.pushUndo(layout);
        editorState.clearRedo();
        colorEditUidRef.current = uid;
      }

      // Update color on the placed furniture item (null removes color)
      const newFurniture = layout.furniture.map((f) =>
        f.uid === uid ? { ...f, color: color ?? undefined } : f,
      );
      const newLayout = { ...layout, furniture: newFurniture };

      editorState.isDirty = true;
      setSessionDirty(true);
      officeState.rebuildFromLayout(newLayout);
      saveLayout(officeId, newLayout);
      setEditorTick((n) => n + 1);
    },
    [getCurrentOfficeContext, editorState, saveLayout, setSessionDirty],
  );

  const handleFurnitureTypeChange = useCallback(
    (type: string) => {
      // Clicking the same item deselects it (no ghost), stays in furniture mode
      if (editorState.selectedFurnitureType === type) {
        editorState.selectedFurnitureType = '';
        editorState.clearGhost();
      } else {
        editorState.selectedFurnitureType = type;
      }
      setEditorTick((n) => n + 1);
    },
    [editorState],
  );

  const handleDeleteSelected = useCallback(() => {
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const { officeState } = getCurrentOfficeContext();
    const currentLayout = officeState.getLayout();
    const newLayout = removeFurniture(currentLayout, uid);
    if (newLayout !== currentLayout) {
      applyEdit(newLayout);
      editorState.clearSelection();
      colorEditUidRef.current = null;
    }
  }, [getCurrentOfficeContext, editorState, applyEdit]);

  const handleRotateSelected = useCallback(() => {
    // If in furniture placement mode, cycle the selected type through the rotation group
    if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const rotated = getRotatedType(editorState.selectedFurnitureType, 'cw');
      if (rotated) {
        editorState.selectedFurnitureType = rotated;
        setEditorTick((n) => n + 1);
      }
      return;
    }
    // Otherwise rotate the selected placed furniture
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const { officeState } = getCurrentOfficeContext();
    const currentLayout = officeState.getLayout();
    const newLayout = rotateFurniture(currentLayout, uid, 'cw');
    if (newLayout !== currentLayout) {
      applyEdit(newLayout);
    }
  }, [getCurrentOfficeContext, editorState, applyEdit]);

  const handleToggleState = useCallback(() => {
    // If in furniture placement mode, toggle the selected type's state
    if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
      const toggled = getToggledType(editorState.selectedFurnitureType);
      if (toggled) {
        editorState.selectedFurnitureType = toggled;
        setEditorTick((n) => n + 1);
      }
      return;
    }
    // Otherwise toggle the selected placed furniture's state
    const uid = editorState.selectedFurnitureUid;
    if (!uid) return;
    const { officeState } = getCurrentOfficeContext();
    const currentLayout = officeState.getLayout();
    const newLayout = toggleFurnitureState(currentLayout, uid);
    if (newLayout !== currentLayout) {
      applyEdit(newLayout);
    }
  }, [getCurrentOfficeContext, editorState, applyEdit]);

  const handleUndo = useCallback(() => {
    const prev = editorState.popUndo();
    if (!prev) return;
    const { officeId, officeState } = getCurrentOfficeContext();
    // Push current layout to redo stack before restoring
    editorState.pushRedo(officeState.getLayout());
    officeState.rebuildFromLayout(prev);
    saveLayout(officeId, prev);
    editorState.isDirty = true;
    setSessionDirty(true);
    setEditorTick((n) => n + 1);
  }, [getCurrentOfficeContext, editorState, saveLayout, setSessionDirty]);

  const handleRedo = useCallback(() => {
    const next = editorState.popRedo();
    if (!next) return;
    const { officeId, officeState } = getCurrentOfficeContext();
    // Push current layout to undo stack before restoring
    editorState.pushUndo(officeState.getLayout());
    officeState.rebuildFromLayout(next);
    saveLayout(officeId, next);
    editorState.isDirty = true;
    setSessionDirty(true);
    setEditorTick((n) => n + 1);
  }, [getCurrentOfficeContext, editorState, saveLayout, setSessionDirty]);

  const handleReset = useCallback(() => {
    const { officeId } = getCurrentOfficeContext();
    const saved = editorSession.checkpoints.get(officeId);
    if (!saved) return;
    applyEdit(saved);
    editorState.reset();
    setSessionDirty(false);
  }, [editorSession, editorState, getCurrentOfficeContext, applyEdit, setSessionDirty]);

  const handleSave = useCallback(() => {
    // Flush any pending debounced save immediately
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      syncSaveTimer(null);
    }
    const { officeId, officeState } = getCurrentOfficeContext();
    const layout = officeState.getLayout();
    editorSession.checkpoints.set(officeId, layout);
    vscode.postMessage(buildSaveLayoutMessage(officeId, layout));
    editorState.isDirty = false;
    setSessionDirty(false);
  }, [editorSession, editorState, getCurrentOfficeContext, setSessionDirty, syncSaveTimer]);

  // Notify React that imperative editor selection changed (e.g., from OfficeCanvas mouseUp)
  const handleEditorSelectionChange = useCallback(() => {
    colorEditUidRef.current = null;
    setEditorTick((n) => n + 1);
  }, []);

  const handleZoomChange = useCallback(
    (newZoom: number) => {
      setSessionZoom(Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom)));
    },
    [setSessionZoom],
  );

  const handleDragMove = useCallback(
    (uid: string, newCol: number, newRow: number) => {
      const { officeState } = getCurrentOfficeContext();
      const layout = officeState.getLayout();
      const newLayout = moveFurniture(layout, uid, newCol, newRow);
      if (newLayout !== layout) {
        applyEdit(newLayout);
      }
    },
    [getCurrentOfficeContext, applyEdit],
  );

  /**
   * Expand layout if click is on a ghost border tile (outside current bounds).
   * Returns the expanded layout and adjusted col/row, or null if no expansion needed.
   */
  const maybeExpand = useCallback(
    (
      layout: OfficeLayout,
      col: number,
      row: number,
    ): {
      layout: OfficeLayout;
      col: number;
      row: number;
      shift: { col: number; row: number };
    } | null => {
      if (col >= 0 && col < layout.cols && row >= 0 && row < layout.rows) return null;

      // Determine which directions to expand
      const directions: ExpandDirection[] = [];
      if (col < 0) directions.push('left');
      if (col >= layout.cols) directions.push('right');
      if (row < 0) directions.push('up');
      if (row >= layout.rows) directions.push('down');

      let current = layout;
      let totalShiftCol = 0;
      let totalShiftRow = 0;
      for (const dir of directions) {
        const result = expandLayout(current, dir);
        if (!result) return null; // exceeded max
        current = result.layout;
        totalShiftCol += result.shift.col;
        totalShiftRow += result.shift.row;
      }

      return {
        layout: current,
        col: col + totalShiftCol,
        row: row + totalShiftRow,
        shift: { col: totalShiftCol, row: totalShiftRow },
      };
    },
    [],
  );

  const handleEditorTileAction = useCallback(
    (col: number, row: number) => {
      const { officeState } = getCurrentOfficeContext();
      let layout = officeState.getLayout();
      let effectiveCol = col;
      let effectiveRow = row;

      // Handle ghost border expansion for floor/wall tools
      if (
        editorState.activeTool === EditTool.TILE_PAINT ||
        editorState.activeTool === EditTool.WALL_PAINT
      ) {
        const expansion = maybeExpand(layout, col, row);
        if (expansion) {
          layout = expansion.layout;
          effectiveCol = expansion.col;
          effectiveRow = expansion.row;
          // Rebuild from expanded layout first, shifting character positions
          officeState.rebuildFromLayout(layout, expansion.shift);
        }
      }

      if (editorState.activeTool === EditTool.TILE_PAINT) {
        const newLayout = paintTile(
          layout,
          effectiveCol,
          effectiveRow,
          editorState.selectedTileType,
          editorState.floorColor,
        );
        if (newLayout !== layout) {
          applyEdit(newLayout);
        }
      } else if (editorState.activeTool === EditTool.WALL_PAINT) {
        const idx = effectiveRow * layout.cols + effectiveCol;
        const isWall = layout.tiles[idx] === TileType.WALL;

        // First tile of drag sets direction
        if (editorState.wallDragAdding === null) {
          editorState.wallDragAdding = !isWall;
        }

        if (editorState.wallDragAdding) {
          // Add wall with color
          const newLayout = paintTile(
            layout,
            effectiveCol,
            effectiveRow,
            TileType.WALL,
            editorState.wallColor,
          );
          if (newLayout !== layout) {
            applyEdit(newLayout);
          }
        } else {
          // Remove wall → paint floor with current floor settings
          if (isWall) {
            const newLayout = paintTile(
              layout,
              effectiveCol,
              effectiveRow,
              editorState.selectedTileType,
              editorState.floorColor,
            );
            if (newLayout !== layout) {
              applyEdit(newLayout);
            }
          }
        }
      } else if (editorState.activeTool === EditTool.ERASE) {
        if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return;
        const idx = row * layout.cols + col;
        if (layout.tiles[idx] === TileType.VOID) return;
        const newLayout = paintTile(layout, col, row, TileType.VOID);
        if (newLayout !== layout) {
          applyEdit(newLayout);
        }
      } else if (editorState.activeTool === EditTool.FURNITURE_PLACE) {
        const type = editorState.selectedFurnitureType;
        if (type === '') {
          // No item selected — act like SELECT (find furniture hit)
          const hit = layout.furniture.find((f) => {
            const entry = getCatalogEntry(f.type);
            if (!entry) return false;
            return (
              col >= f.col &&
              col < f.col + entry.footprintW &&
              row >= f.row &&
              row < f.row + entry.footprintH
            );
          });
          editorState.selectedFurnitureUid = hit ? hit.uid : null;
          setEditorTick((n) => n + 1);
        } else {
          const placementRow = getWallPlacementRow(type, row);
          if (!canPlaceFurniture(layout, type, col, placementRow)) return;
          const uid = `f-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
          const placed: PlacedFurniture = { uid, type, col, row: placementRow };
          if (editorState.pickedFurnitureColor) {
            placed.color = { ...editorState.pickedFurnitureColor };
          }
          const newLayout = placeFurniture(layout, placed);
          if (newLayout !== layout) {
            applyEdit(newLayout);
          }
        }
      } else if (editorState.activeTool === EditTool.FURNITURE_PICK) {
        // Find furniture at clicked tile, copy its type and color for placement
        const hit = layout.furniture.find((f) => {
          const entry = getCatalogEntry(f.type);
          if (!entry) return false;
          return (
            col >= f.col &&
            col < f.col + entry.footprintW &&
            row >= f.row &&
            row < f.row + entry.footprintH
          );
        });
        if (hit) {
          editorState.selectedFurnitureType = hit.type;
          editorState.pickedFurnitureColor = hit.color ? { ...hit.color } : null;
          editorState.activeTool = EditTool.FURNITURE_PLACE;
        }
        setEditorTick((n) => n + 1);
      } else if (editorState.activeTool === EditTool.EYEDROPPER) {
        const idx = row * layout.cols + col;
        const tile = layout.tiles[idx];
        if (tile !== undefined && tile !== TileType.WALL && tile !== TileType.VOID) {
          editorState.selectedTileType = tile;
          const color = layout.tileColors?.[idx];
          if (color) {
            editorState.floorColor = { ...color };
          }
          editorState.activeTool = EditTool.TILE_PAINT;
        } else if (tile === TileType.WALL) {
          // Pick wall color and switch to wall tool
          const color = layout.tileColors?.[idx];
          if (color) {
            editorState.wallColor = { ...color };
          }
          editorState.activeTool = EditTool.WALL_PAINT;
        }
        setEditorTick((n) => n + 1);
      } else if (editorState.activeTool === EditTool.SELECT) {
        const hit = layout.furniture.find((f) => {
          const entry = getCatalogEntry(f.type);
          if (!entry) return false;
          return (
            col >= f.col &&
            col < f.col + entry.footprintW &&
            row >= f.row &&
            row < f.row + entry.footprintH
          );
        });
        editorState.selectedFurnitureUid = hit ? hit.uid : null;
        setEditorTick((n) => n + 1);
      }
    },
    [getCurrentOfficeContext, editorState, applyEdit, maybeExpand],
  );

  const handleEditorEraseAction = useCallback(
    (col: number, row: number) => {
      const { officeState } = getCurrentOfficeContext();
      const layout = officeState.getLayout();
      if (col < 0 || col >= layout.cols || row < 0 || row >= layout.rows) return;
      const idx = row * layout.cols + col;
      // Only erase non-VOID tiles
      if (layout.tiles[idx] === TileType.VOID) return;
      const newLayout = paintTile(layout, col, row, TileType.VOID);
      if (newLayout !== layout) {
        applyEdit(newLayout);
      }
    },
    [getCurrentOfficeContext, applyEdit],
  );

  return {
    isEditMode: editorSession.isEditMode,
    editorTick,
    isDirty: editorSession.isDirty,
    zoom: editorSession.zoom,
    panRef,
    saveTimerRef,
    setLastSavedLayout,
    handleOpenClaude,
    handleToggleEditMode,
    handleToolChange,
    handleTileTypeChange,
    handleFloorColorChange,
    handleWallColorChange,
    handleWallSetChange,
    handleSelectedFurnitureColorChange,
    handleFurnitureTypeChange,
    handleDeleteSelected,
    handleRotateSelected,
    handleToggleState,
    handleUndo,
    handleRedo,
    handleReset,
    handleSave,
    handleZoomChange,
    handleEditorTileAction,
    handleEditorEraseAction,
    handleEditorSelectionChange,
    handleDragMove,
  };
}
