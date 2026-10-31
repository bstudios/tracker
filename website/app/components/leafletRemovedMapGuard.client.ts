import { Map as LeafletMap } from "leaflet";

/**
 * Leaflet's drag handler finishes a flick by scheduling `map.panBy(...)` on the next
 * animation frame to animate the inertia. `map.remove()` does not cancel that frame, so
 * if the map unmounts in between — a flick on the live map immediately followed by a tap
 * that navigates away, say — the callback runs against a map whose `_mapPane` has been
 * deleted, and `addClass(undefined, "leaflet-pan-anim")` throws. Panning a removed map
 * has nothing to do, so skip it.
 *
 * Imported for its side effect by every component that renders a `MapContainer`.
 */
type GuardedMap = LeafletMap & { _mapPane?: HTMLElement };
type GuardedPrototype = GuardedMap & { __trackerRemovedMapGuard?: true };

const proto = LeafletMap.prototype as GuardedPrototype;

if (!proto.__trackerRemovedMapGuard) {
  proto.__trackerRemovedMapGuard = true;
  const originalPanBy = proto.panBy;
  proto.panBy = function (this: GuardedMap, offset, options) {
    if (!this._mapPane) {
      return this;
    }
    return originalPanBy.call(this, offset, options);
  };
}
