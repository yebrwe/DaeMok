#!/usr/bin/env python3
"""Render a review sheet for the exported DaeMok maze GLBs."""

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
    parser.add_argument("--output", default="/tmp/daemok-maze-assets-preview.png")
    return parser.parse_args(argv)


def look_at(obj: bpy.types.Object, target: tuple[float, float, float]) -> None:
    direction = Vector(target) - obj.location
    obj.rotation_euler = direction.to_track_quat("-Z", "Y").to_euler()


def import_asset(asset_dir: Path, filename: str, location: tuple[float, float, float]) -> bpy.types.Object:
    before = set(bpy.context.scene.objects)
    bpy.ops.import_scene.gltf(filepath=str(asset_dir / filename))
    imported = set(bpy.context.scene.objects) - before
    roots = [obj for obj in imported if obj.parent is None]
    assert len(roots) == 1, f"expected one root in {filename}, found {len(roots)}"
    root = roots[0]
    root.location = location
    for obj in imported:
        if obj.type == "MESH":
            obj.select_set(False)
    return root


def main() -> None:
    args = parse_args()
    asset_dir = Path(args.asset_dir).resolve()
    output = Path(args.output).resolve()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    # The first row communicates the main play pieces; the second row shows
    # all active special walls without legacy collapse/mirror variants.
    import_asset(asset_dir, "rabbit-pawn.glb", (-4.25, -1.45, 0))
    import_asset(asset_dir, "tile-cream.glb", (-3.05, -1.25, 0))
    import_asset(asset_dir, "marker-start.glb", (-3.05, -1.25, 0.166))
    import_asset(asset_dir, "tile-sage.glb", (-1.95, -1.25, 0))
    import_asset(asset_dir, "marker-goal.glb", (-1.95, -1.25, 0.166))
    import_asset(asset_dir, "wall-normal.glb", (-0.55, -1.25, 0))

    wall_files = [
        "wall-fire.glb",
        "wall-poison.glb",
        "wall-ice.glb",
        "wall-wind.glb",
        "wall-thorn.glb",
        "wall-fog.glb",
        "wall-illusion.glb",
    ]
    for index, filename in enumerate(wall_files):
        row = index // 4
        col = index % 4
        import_asset(asset_dir, filename, (-3.4 + col * 2.0, 0.2 + row * 1.45, 0))

    # Neutral studio floor.
    bpy.ops.mesh.primitive_plane_add(size=20, location=(0, 0, -0.025))
    floor = bpy.context.object
    floor.name = "preview_floor"
    floor_mat = bpy.data.materials.new("preview_floor_material")
    floor_mat.diffuse_color = (0.16, 0.24, 0.22, 1)
    floor_mat.use_nodes = True
    floor.data.materials.append(floor_mat)

    bpy.ops.object.light_add(type="AREA", location=(-3.5, -4.5, 8))
    key = bpy.context.object
    key.data.energy = 1100
    key.data.shape = "DISK"
    key.data.size = 5.5
    key.data.color = (1.0, 0.74, 0.48)
    look_at(key, (0, 0, 0))
    bpy.ops.object.light_add(type="AREA", location=(5, 2, 5))
    fill = bpy.context.object
    fill.data.energy = 750
    fill.data.size = 5
    fill.data.color = (0.44, 0.78, 0.82)
    look_at(fill, (0, 0, 0.4))

    bpy.ops.object.camera_add(location=(7.6, -12.5, 9.2))
    camera = bpy.context.object
    look_at(camera, (-0.25, 0.25, 0.35))
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 10.5
    bpy.context.scene.camera = camera

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_EEVEE"
    scene.render.resolution_x = 1500
    scene.render.resolution_y = 950
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.filepath = str(output)
    scene.render.film_transparent = False
    scene.render.use_freestyle = True
    scene.view_settings.look = "AgX - Medium High Contrast"
    scene.world.color = (0.055, 0.09, 0.085)
    bpy.ops.render.render(write_still=True)
    print(f"rendered {output}")


if __name__ == "__main__":
    main()
