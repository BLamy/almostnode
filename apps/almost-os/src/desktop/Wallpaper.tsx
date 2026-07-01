import type { CSSProperties } from "react";
import { WALLPAPERS, useAppearance } from "../os/appearance";

export function Wallpaper() {
  const { wallpaper } = useAppearance();
  const wp = WALLPAPERS.find((w) => w.id === wallpaper) ?? WALLPAPERS[0];
  const style = {
    background: wp.base,
    "--glow-one": wp.glows[0],
    "--glow-two": wp.glows[1],
    "--glow-three": wp.glows[2],
  } as CSSProperties;

  return (
    <div className="os-wallpaper" aria-hidden="true" style={style}>
      <div className="os-wallpaper__glow os-wallpaper__glow--one" />
      <div className="os-wallpaper__glow os-wallpaper__glow--two" />
      <div className="os-wallpaper__glow os-wallpaper__glow--three" />
    </div>
  );
}
