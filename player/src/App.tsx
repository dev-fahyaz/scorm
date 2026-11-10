import { useEffect, useState } from "react";
import { Library } from "./Library";
import { PlayerView } from "./PlayerView";

type Route = { name: "library" } | { name: "player"; courseId: string; itemId: string | null };

function readRoute(): Route {
  const match = window.location.pathname.match(/^\/play\/([^/]+)(?:\/([^/]+))?\/?$/);
  if (!match?.[1]) return { name: "library" };
  return {
    name: "player",
    courseId: decodeURIComponent(match[1]),
    itemId: match[2] ? decodeURIComponent(match[2]) : null,
  };
}

export function navigate(path: string): void {
  window.history.pushState({}, "", path);
  window.dispatchEvent(new PopStateEvent("popstate"));
}

export function App() {
  const [route, setRoute] = useState<Route>(readRoute);

  useEffect(() => {
    const onPop = () => setRoute(readRoute());
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  return (
    <div className="app">
      <header className="topbar">
        <button className="brand" type="button" onClick={() => navigate("/")}>
          <span className="mark" aria-hidden="true" />
          <span>Aspire TSS</span>
        </button>
        <p>SCORM player</p>
      </header>
      {route.name === "library" ? (
        <Library />
      ) : (
        <PlayerView courseId={route.courseId} itemId={route.itemId} />
      )}
    </div>
  );
}
