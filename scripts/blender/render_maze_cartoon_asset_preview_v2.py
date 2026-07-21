#!/usr/bin/env python3
"""Render the 14-piece completion pack and its shared 4x4 tile contract."""

from __future__ import annotations

import argparse
import math
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--asset-dir", default="public/assets/maze/v1")
    parser.add_argument("--output", default="/tmp/daemok-maze-assets-v2-preview.png")
    return parser.parse_args(argv)


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def import_asset(
    asset_dir: Path,
    filename: str,
    location: tuple[float, float, float],
    *,
    rotation_z: float = 0,
) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(asset_dir / filename))
    imported = set(bpy.context.scene.objects) - before
    roots = [obj for obj in imported if obj.parent is None]
    assert len(roots) == 1, f"expected one root in {filename}, found {len(roots)}"
    root = roots[0]
    root.location = location
    root.rotation_euler[2] = rotation_z
    return root


def main() -> None:
    args = parse_args()
    asset_dir = Path(args.asset_dir).resolve()
    output = Path(args.output).resolve()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # Left: the real runtime composition.  The base is below Y=0, the existing
    # v1 tile assets are rooted at -0.08, and all wormhole props begin at +0.08.
    board_x = -3.0
    board_y = 0.25
    import_asset(asset_dir, "wormhole-board-base.glb", (board_x, board_y, 0))
    start = -(4 - 1) * 1.14 / 2
    for row in range(4):
        for col in range(4):
            filename = "tile-cream.glb" if (row + col) % 2 == 0 else "tile-sage.glb"
            import_asset(
                asset_dir,
                filename,
                (board_x + start + col * 1.14, board_y + start + row * 1.14, -0.08),
            )
    import_asset(asset_dir, "wormhole-die.glb", (board_x - 1.71, board_y - 1.71, 0.08), rotation_z=-0.2)
    import_asset(asset_dir, "wormhole-rock.glb", (board_x + 0.57, board_y - 0.57, 0.08), rotation_z=0.35)
    import_asset(asset_dir, "wormhole-rock.glb", (board_x - 0.57, board_y + 0.57, 0.08), rotation_z=-0.22)
    import_asset(asset_dir, "wormhole-target-pad.glb", (board_x + 1.71, board_y + 1.71, 0.08))

    # Right: active/used item pairs, finished goal, portal, legacy die and walls.
    import_asset(asset_dir, "wormhole-portal.glb", (0.15, 1.75, 0.08))
    import_asset(asset_dir, "wall-collapse.glb", (1.55, 1.75, 0))
    import_asset(asset_dir, "wall-mirror.glb", (3.05, 1.75, 0))
    import_asset(asset_dir, "goal-flag.glb", (4.2, 1.55, 0.08))
    import_asset(asset_dir, "goal-lock.glb", (4.7, 1.55, 0.08))

    import_asset(asset_dir, "item-mine.glb", (0.35, 0.35, 0.08))
    import_asset(asset_dir, "item-mine-used.glb", (1.35, 0.35, 0.08))
    import_asset(asset_dir, "item-smoke.glb", (2.45, 0.35, 0.08))
    import_asset(asset_dir, "item-smoke-used.glb", (3.45, 0.35, 0.08), rotation_z=0.35)
    import_asset(asset_dir, "legacy-seal-die.glb", (4.55, 0.25, 0.08), rotation_z=-0.25)

    # Neutral studio floor sits just below both board bases.
    bpy.ops.mesh.primitive_plane_add(size=22, location=(0, 0, -0.49))
    floor = bpy.context.object
    floor.name = "preview_floor"
    floor_mat = bpy.data.materials.new("preview_floor_material")
    floor_mat.diffuse_color = (0.14, 0.21, 0.19, 1)
    floor_mat.use_nodes = True
    floor.data.materials.append(floor_mat)

    bpy.ops.object.light_add(type="AREA", location=(-4.5, -5.5, 9))
    key = bpy.context.object
    key.data.energy = 1250
    key.data.shape = "DISK"
    key.data.size = 6
    key.data.color = (1.0, 0.76, 0.54)
    look_at(key, (-0.5, 0.3, 0))
    bpy.ops.object.light_add(type="AREA", location=(6, 3.5, 6))
    fill = bpy.context.object
    fill.data.energy = 850
    fill.data.size = 5
    fill.data.color = (0.46, 0.78, 0.9)
    look_at(fill, (0, 0.5, 0.3))

    bpy.ops.object.camera_add(location=(8.6, -13.5, 10.6))
    camera = bpy.context.object
    look_at(camera, (-0.25, 0.45, 0.1))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 11.2
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1600
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    scene.render.use_freestyle = True
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.045, 0.075, 0.07)
    bpy.ops.render.render(write_still=True)
    print(f"rendered {output}")


if __name__ == "__main__":
    main()
