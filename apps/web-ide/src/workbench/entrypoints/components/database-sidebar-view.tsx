import { useState } from "react";
import type { SurfaceModel } from "../../framework/model";
import { useSurfaceModel } from "../../framework/hooks";
import type {
  DatabaseSidebarActions,
  DatabaseSidebarState,
} from "../../surface-model-types";

export default function DatabaseSidebarView(props: {
  model: SurfaceModel<DatabaseSidebarState, DatabaseSidebarActions>;
}) {
  const [state, actions] = useSurfaceModel(props.model);
  const [name, setName] = useState("");

  return (
    <div
      className="almostnode-db-sidebar"
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
      <div style={{ fontWeight: 600, marginBottom: "4px" }}>Databases</div>
      <div
        style={{
          flex: 1,
          overflowY: "auto",
          display: "flex",
          flexDirection: "column",
          gap: "2px",
        }}
      >
        {state.databases.map((database) => {
          const isActive = database.name === state.activeName;
          return (
            <div
              key={database.name}
              style={{
                display: "flex",
                alignItems: "center",
                gap: "6px",
                padding: "4px 8px",
                borderRadius: "3px",
                cursor: "pointer",
                color: isActive
                  ? "var(--almostnode-list-active-fg)"
                  : "var(--text)",
                background: isActive
                  ? "var(--almostnode-list-active-bg)"
                  : "transparent",
              }}
              onClick={() => actions.open(database.name)}
            >
              <span
                style={{
                  width: "6px",
                  height: "6px",
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: isActive
                    ? "var(--almostnode-success)"
                    : "var(--almostnode-quiet)",
                }}
              />
              <span
                style={{
                  flex: 1,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {database.name}
              </span>
              {state.databases.length > 1 ? (
                <button
                  type="button"
                  title={`Delete ${database.name}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    actions.delete(database.name);
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
              ) : null}
            </div>
          );
        })}
      </div>
      <div style={{ display: "flex", gap: "4px" }}>
        <input
          type="text"
          placeholder="New database name"
          value={name}
          onChange={(event) => setName(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && name.trim()) {
              actions.create(name.trim());
              setName("");
            }
          }}
          style={{
            flex: 1,
            background: "var(--almostnode-input-bg)",
            border: "1px solid var(--almostnode-input-border)",
            color: "var(--almostnode-input-fg)",
            padding: "4px 8px",
            borderRadius: "3px",
            fontSize: "12px",
          }}
        />
        <button
          type="button"
          onClick={() => {
            if (!name.trim()) {
              return;
            }
            actions.create(name.trim());
            setName("");
          }}
          style={{
            background: "var(--almostnode-primary-button-bg)",
            color: "var(--almostnode-primary-button-fg)",
            border: "none",
            padding: "4px 10px",
            borderRadius: "3px",
            cursor: "pointer",
            fontSize: "12px",
          }}
        >
          Create
        </button>
      </div>
    </div>
  );
}
