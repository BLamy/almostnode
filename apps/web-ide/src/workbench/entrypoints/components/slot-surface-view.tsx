import type { SurfaceModel } from "../../framework/model";
import { DomSlotHost } from "../../framework/dom-slot";
import { useSurfaceModel } from "../../framework/hooks";
import type {
  SlotSurfaceActions,
  SlotSurfaceState,
} from "../../surface-model-types";

export default function SlotSurfaceView(props: {
  model: SurfaceModel<SlotSurfaceState, SlotSurfaceActions>;
}) {
  const [state] = useSurfaceModel(props.model);
  return (
    <DomSlotHost
      slot={state.slot}
      className="almostnode-slot-surface-host"
    />
  );
}
