import type { SurfaceModel } from "../../framework/model";
import { useSurfaceModel } from "../../framework/hooks";
import type {
  TestsSidebarActions,
  TestsSidebarState,
} from "../../surface-model-types";

function statusColor(status: TestsSidebarState["tests"][number]["status"]): string {
  switch (status) {
    case "passed":
      return "var(--almostnode-success)";
    case "failed":
      return "var(--almostnode-danger)";
    case "running":
      return "var(--almostnode-warning)";
    default:
      return "var(--almostnode-quiet)";
  }
}

export default function TestsSidebarView(props: {
  model: SurfaceModel<TestsSidebarState, TestsSidebarActions>;
}) {
  const [state, actions] = useSurfaceModel(props.model);

  return (
    <div
      className="almostnode-tests-sidebar"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        padding: "8px",
        gap: "8px",
        color: "var(--text)",
        fontSize: "13px",
        background: "var(--almostnode-surface-alt-bg)",
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>Tests</div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {state.tests.length === 0 ? (
          <div
            style={{
              color: "var(--almostnode-quiet)",
              fontStyle: "italic",
              padding: "4px 8px",
              fontSize: "12px",
            }}
          >
            No tests recorded yet. Use OpenCode to interact with the preview and
            tests will be auto-detected.
          </div>
        ) : (
          state.tests.map((test) => (
            <div
              key={test.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                borderRadius: "3px",
                cursor: "pointer",
                color: "var(--text)",
              }}
            >
              <span
                style={{
                  width: "8px",
                  height: "8px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: statusColor(test.status),
                  animation:
                    test.status === "running"
                      ? "almostnode-test-pulse 1s ease-in-out infinite"
                      : undefined,
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: "12px",
                }}
                onClick={() => actions.open(test.id)}
              >
                {test.name}
              </span>
              <button
                type="button"
                title={`Run ${test.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.run(test.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--almostnode-success)",
                  cursor: "pointer",
                  fontSize: "12px",
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >
                ▶
              </button>
              <button
                type="button"
                title={`Delete ${test.name}`}
                onClick={(event) => {
                  event.stopPropagation();
                  actions.delete(test.id);
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--almostnode-quiet)",
                  cursor: "pointer",
                  fontSize: "16px",
                  padding: "0 2px",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>
          ))
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: "4px",
          paddingTop: "8px",
          borderTop: "1px solid var(--almostnode-toolbar-border)",
        }}
      >
        <button
          type="button"
          onClick={() => actions.runAll()}
          style={{
            flex: 1,
            background: "var(--almostnode-primary-button-bg)",
            color: "var(--almostnode-primary-button-fg)",
            border: "none",
            padding: "4px 10px",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Run All
        </button>
      </div>
    </div>
  );
}
