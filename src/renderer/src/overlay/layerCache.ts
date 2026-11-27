/** Inputs that decide whether the cached static annotation layer is still valid. */
export interface LayerKey {
  /** AnnotationStore.version */
  version: number
  pixelWidth: number
  pixelHeight: number
  ratio: number
  /** Id of the annotation being dragged (excluded from the layer), or null. */
  draggedId: string | null
}

export function sameLayerKey(a: LayerKey | null, b: LayerKey): boolean {
  return (
    a !== null &&
    a.version === b.version &&
    a.pixelWidth === b.pixelWidth &&
    a.pixelHeight === b.pixelHeight &&
    a.ratio === b.ratio &&
    a.draggedId === b.draggedId
  )
}
