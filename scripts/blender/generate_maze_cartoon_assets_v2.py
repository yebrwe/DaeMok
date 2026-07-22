#!/usr/bin/env python3
"""Generate the second texture-free Blender cartoon asset pack for DaeMok.

This pack completes the runtime pieces that remained procedural after the v1
board/pawn/wall pass.  Blender is Z-up while exported glTF is Y-up; Blender
-Y therefore becomes runtime +Z.  Every individual prop is ground anchored.

    blender --background --factory-startup \
      --python scripts/blender/generate_maze_cartoon_assets_v2.py -- \
      --output-dir public/assets/maze/v1
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path
from typing import Callable

import bpy

# Blender places the script directory on sys.path, not necessarily the repo
# root.  Reuse the audited v1 mesh/export helpers from the adjacent module.
SCRIPT_DIR = Path(__file__).resolve().parent
if str(SCRIPT_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPT_DIR))
import generate_maze_cartoon_assets as base  # noqa: E402


# Runtime intentionally keeps one stable /maze/v1 catalog.  This generator is
# revision 2 of the source pipeline, but exported root extras continue to match
# manifest.version=1 so cached v1 assets remain compatible.
PACK_VERSION = 1
GENERATOR_REVISION = 2
WORMHOLE_BOARD_SIZE = 4
WORMHOLE_TILE_SIZE = 1.0
WORMHOLE_GAP = 0.14
WORMHOLE_SPACING = WORMHOLE_TILE_SIZE + WORMHOLE_GAP
WORMHOLE_GRID_SPAN = round(WORMHOLE_BOARD_SIZE * WORMHOLE_SPACING - WORMHOLE_GAP, 4)
WORMHOLE_TILE_ROOT_Y = -0.08
WORMHOLE_PLAYABLE_TOP_Y = 0.08
DIE_SIDE = 0.612
DIE_CENTER_HEIGHT = DIE_SIDE / 2


PIPS: dict[int, tuple[tuple[int, int], ...]] = {
    1: ((0, 0),),
    2: ((-1, -1), (1, 1)),
    3: ((-1, -1), (0, 0), (1, 1)),
    4: ((-1, -1), (-1, 1), (1, -1), (1, 1)),
    5: ((-1, -1), (-1, 1), (0, 0), (1, -1), (1, 1)),
    6: ((-1, -1), (-1, 0), (-1, 1), (1, -1), (1, 0), (1, 1)),
}


def mat(
    name: str,
    color: str,
    *,
    roughness: float = 0.82,
    metallic: float = 0.0,
    emissive: str | None = None,
    emissive_strength: float = 0.0,
) -> bpy.types.Material:
    return base.material(
        name,
        color,
        roughness=roughness,
        metallic=metallic,
        emissive=emissive,
        emissive_strength=emissive_strength,
    )


def add_die_pips(
    asset: bpy.types.Object,
    pip_material: bpy.types.Material,
    *,
    side: float,
    bottom: float,
    prefix: str,
) -> None:
    """Add all six physical faces using the runtime's canonical orientation.

    glTF: 1=+Y, 6=-Y, 2=-Z, 5=+Z, 3=+X, 4=-X.
    Source Blender axes after Y-up export: glTF (x,y,z)=(x,z,-y).
    """
    pip_radius = side * 0.052
    pip_depth = side * 0.0196
    spread = side * 0.18
    center_z = bottom + side / 2
    surface = side / 2 - pip_depth / 2

    # value, source face axis, sign, two in-face source axes
    faces = (
        (1, "z", 1, "x", "y"),   # glTF +Y
        (6, "z", -1, "x", "y"),  # glTF -Y
        (2, "y", 1, "x", "z"),   # glTF -Z
        (5, "y", -1, "x", "z"),  # glTF +Z
        (3, "x", 1, "y", "z"),   # glTF +X
        (4, "x", -1, "y", "z"),  # glTF -X
    )

    for value, normal_axis, sign, axis_u, axis_v in faces:
        for index, (u, v) in enumerate(PIPS[value]):
            coords = {"x": 0.0, "y": 0.0, "z": center_z}
            coords[normal_axis] = (
                center_z + sign * surface if normal_axis == "z" else sign * surface
            )
            coords[axis_u] += u * spread
            coords[axis_v] += v * spread
            rotation = (
                (0.0, 0.0, 0.0)
                if normal_axis == "z"
                else (math.pi / 2, 0.0, 0.0)
                if normal_axis == "y"
                else (0.0, math.pi / 2, 0.0)
            )
            base.cylinder(
                f"{prefix}_pip_{value}_{index}",
                pip_radius,
                pip_depth,
                (coords["x"], coords["y"], coords["z"]),
                pip_material,
                parent=asset,
                vertices=12,
                rotation=rotation,
                role=f"die_face_{value}",
            )


def make_wormhole_die() -> bpy.types.Object:
    asset = base.root("asset_wormhole_die")
    body = mat("mat_wormhole_die_body", "#FFF4D8", roughness=0.72)
    pips = mat("mat_wormhole_die_pips", "#34251F", roughness=0.9)
    # A slightly inset body leaves exactly 0.012 units for raised pips.  The
    # resulting exported bounds are 0.612 cubed and its center is Y=0.306.
    body_side = DIE_SIDE - 0.024
    base.bevelled_box(
        "wormhole_die_body",
        (body_side, body_side, body_side),
        (0, 0, DIE_CENTER_HEIGHT),
        body,
        bevel=0.075,
        parent=asset,
        role="die_body",
    )
    add_die_pips(asset, pips, side=DIE_SIDE, bottom=0, prefix="wormhole_die")
    return asset


def make_wormhole_board_base() -> bpy.types.Object:
    asset = base.root("asset_wormhole_board_base")
    lower = mat("mat_wormhole_board_base_dark", "#405E57", roughness=0.96)
    rim = mat("mat_wormhole_board_base_rim", "#789178", roughness=0.92)
    # The runtime reuses the existing v1 cream/sage tile GLBs for all 16 cells.
    # This asset stays entirely below their root seam (Y=-0.08 after export),
    # preventing duplicate tiles and reducing the board from four channels to two.
    base.bevelled_box(
        "wormhole_board_lower",
        (WORMHOLE_GRID_SPAN + 0.48, WORMHOLE_GRID_SPAN + 0.48, 0.12),
        (0, 0, -0.40),
        lower,
        bevel=0.09,
        parent=asset,
        role="board_base",
    )
    base.bevelled_box(
        "wormhole_board_rim",
        (WORMHOLE_GRID_SPAN + 0.28, WORMHOLE_GRID_SPAN + 0.28, 0.28),
        (0, 0, -0.22),
        rim,
        bevel=0.075,
        parent=asset,
        role="board_rim",
    )
    return asset


def make_wormhole_rock() -> bpy.types.Object:
    asset = base.root("asset_wormhole_rock")
    body = mat("mat_wormhole_rock_body", "#4B3D64", roughness=0.88)
    accent = mat(
        "mat_wormhole_rock_accent", "#B687E8", roughness=0.55,
        emissive="#6F3EB5", emissive_strength=0.34,
    )
    for index, (x, y, radius, height) in enumerate((
        (-0.13, 0.04, 0.19, 0.46),
        (0.12, 0.06, 0.16, 0.55),
        (0.0, -0.13, 0.14, 0.39),
    )):
        base.cone(
            f"wormhole_rock_shard_{index}", radius, height, (x, y, height / 2),
            accent if index == 1 else body, parent=asset, vertices=6, role="dimension_rock",
        )
    base.torus(
        "wormhole_rock_rune", 0.19, 0.024, (0, 0, 0.055), accent,
        parent=asset, role="dimension_rune",
    )
    return asset


def make_wormhole_target_pad() -> bpy.types.Object:
    asset = base.root("asset_wormhole_target_pad")
    body = mat("mat_wormhole_target_body", "#51366E", roughness=0.86)
    accent = mat(
        "mat_wormhole_target_accent", "#D5A7FF", roughness=0.64,
        emissive="#874CC8", emissive_strength=0.46,
    )
    base.cylinder("wormhole_target_body", 0.39, 0.055, (0, 0, 0.0275), body, parent=asset, vertices=24, role="target_body")
    base.torus("wormhole_target_ring", 0.275, 0.038, (0, 0, 0.07), accent, parent=asset, role="target_accent")
    # Four compass studs make the common pad readable regardless of target die face.
    for index, (x, y) in enumerate(((0, -0.22), (0.22, 0), (0, 0.22), (-0.22, 0))):
        base.cylinder(
            f"wormhole_target_stud_{index}", 0.032, 0.024, (x, y, 0.068),
            accent, parent=asset, vertices=8, role="target_accent",
        )
    return asset


def make_wormhole_portal() -> bpy.types.Object:
    asset = base.root("asset_wormhole_portal")
    body = mat("mat_wormhole_portal_body", "#4A176C", roughness=0.8)
    accent = mat(
        "mat_wormhole_portal_accent", "#B267E8", roughness=0.55,
        emissive="#8D3BC7", emissive_strength=0.62,
    )
    core = mat(
        "mat_wormhole_portal_core", "#251039", roughness=0.94,
        emissive="#351154", emissive_strength=0.18,
    )
    base.cylinder("wormhole_portal_core", 0.285, 0.035, (0, 0, 0.0175), core, parent=asset, vertices=28, role="portal_core")
    base.torus("wormhole_portal_outer", 0.305, 0.052, (0, 0, 0.056), body, parent=asset, role="portal_body")
    base.torus("wormhole_portal_inner", 0.192, 0.028, (0, 0, 0.092), accent, parent=asset, role="portal_accent")
    for index, angle in enumerate((0, math.pi * 2 / 3, math.pi * 4 / 3)):
        base.sphere(
            f"wormhole_portal_orb_{index}",
            (math.cos(angle) * 0.305, math.sin(angle) * 0.305, 0.11),
            (0.042, 0.042, 0.042), accent, parent=asset, role="portal_accent",
            segments=12, rings=8,
        )
    return asset


def make_item_mine() -> bpy.types.Object:
    asset = base.root("asset_item_mine")
    body = mat("mat_item_mine_body", "#394554", roughness=0.48, metallic=0.38)
    metal = mat("mat_item_mine_metal", "#81909B", roughness=0.42, metallic=0.48)
    lamp = mat(
        "mat_item_mine_lamp", "#FF5A4F", roughness=0.55,
        emissive="#E1322C", emissive_strength=0.9,
    )
    base.cylinder("item_mine_foot", 0.22, 0.045, (0, 0, 0.0225), metal, parent=asset, vertices=16, role="mine_foot")
    base.sphere("item_mine_body", (0, 0, 0.18), (0.18, 0.18, 0.16), body, parent=asset, role="mine_body")
    for index, angle in enumerate((0, math.pi / 2, math.pi, math.pi * 1.5)):
        base.cone(
            f"item_mine_spike_{index}", 0.035, 0.12,
            (math.cos(angle) * 0.205, math.sin(angle) * 0.205, 0.15),
            metal, parent=asset, vertices=6, rotation=(0, math.pi / 2, angle), role="mine_metal",
        )
    base.cylinder("item_mine_lamp_stem", 0.025, 0.09, (0, 0, 0.355), metal, parent=asset, vertices=8, role="mine_metal")
    base.sphere("item_mine_lamp", (0, 0, 0.414), (0.045, 0.045, 0.045), lamp, parent=asset, role="mine_lamp", segments=12, rings=8)
    return asset


def make_item_mine_used() -> bpy.types.Object:
    asset = base.root("asset_item_mine_used")
    body = mat("mat_item_mine_used_body", "#252422", roughness=1.0)
    accent = mat("mat_item_mine_used_accent", "#6A4938", roughness=0.98)
    base.cylinder("item_mine_used_scorch", 0.31, 0.025, (0, 0, 0.0125), body, parent=asset, vertices=24, role="used_mark")
    base.torus("item_mine_used_crater", 0.19, 0.045, (0, 0, 0.052), accent, parent=asset, role="used_crater")
    for index, angle in enumerate((0.25, 2.3, 4.25)):
        shard = base.bevelled_box(
            f"item_mine_used_shard_{index}", (0.11, 0.045, 0.035),
            (math.cos(angle) * 0.24, math.sin(angle) * 0.24, 0.042), accent,
            bevel=0.008, parent=asset, role="used_shard",
        )
        shard.rotation_euler[2] = angle
    return asset


def make_item_smoke() -> bpy.types.Object:
    asset = base.root("asset_item_smoke")
    body = mat("mat_item_smoke_body", "#607180", roughness=0.58, metallic=0.25)
    metal = mat("mat_item_smoke_metal", "#C4D0D6", roughness=0.38, metallic=0.5)
    fuse = mat(
        "mat_item_smoke_fuse", "#FFB340", roughness=0.7,
        emissive="#F07628", emissive_strength=0.68,
    )
    base.cylinder("item_smoke_body", 0.16, 0.30, (0, 0, 0.15), body, parent=asset, vertices=16, role="smoke_body")
    base.torus("item_smoke_bottom_ring", 0.13, 0.018, (0, 0, 0.025), metal, parent=asset, role="smoke_metal")
    base.torus("item_smoke_top_ring", 0.13, 0.018, (0, 0, 0.282), metal, parent=asset, role="smoke_metal")
    base.cylinder("item_smoke_cap", 0.09, 0.055, (0, 0, 0.3275), metal, parent=asset, vertices=12, role="smoke_metal")
    fuse_obj = base.cylinder(
        "item_smoke_fuse", 0.018, 0.12, (0.045, 0, 0.41), fuse,
        parent=asset, vertices=8, rotation=(0, 0.36, 0), role="smoke_fuse",
    )
    fuse_obj.rotation_euler[1] = 0.36
    return asset


def make_item_smoke_used() -> bpy.types.Object:
    asset = base.root("asset_item_smoke_used")
    body = mat("mat_item_smoke_used_body", "#343A3D", roughness=1.0)
    accent = mat("mat_item_smoke_used_accent", "#707A7D", roughness=0.9)
    base.cylinder("item_smoke_used_scorch", 0.27, 0.022, (0, 0, 0.011), body, parent=asset, vertices=20, role="used_mark")
    crushed = base.cylinder(
        "item_smoke_used_can", 0.13, 0.22, (0, 0, 0.105), accent,
        parent=asset, vertices=12, rotation=(0, math.pi / 2, 0.24), role="used_can",
    )
    crushed.scale.z = 0.52
    # Rotation widens the can's vertical bound; keep the crushed prop exactly
    # on its ground plane after that authored tilt.
    crushed.location.z += 0.025
    return asset


def make_goal_flag() -> bpy.types.Object:
    asset = base.root("asset_goal_flag")
    base_mat = mat("mat_goal_flag_base", "#C8534C", roughness=0.86)
    pole = mat("mat_goal_flag_pole", "#766B61", roughness=0.58, metallic=0.18)
    cloth = mat(
        "mat_goal_flag_cloth", "#EF6B62", roughness=0.76,
        emissive="#9A302E", emissive_strength=0.08,
    )
    base.cylinder("goal_flag_base", 0.19, 0.07, (0, 0, 0.035), base_mat, parent=asset, vertices=18, role="goal_base")
    base.cylinder("goal_flag_pole", 0.025, 0.83, (0, 0, 0.465), pole, parent=asset, vertices=10, role="goal_pole")
    base.sphere("goal_flag_finial", (0, 0, 0.905), (0.045, 0.045, 0.045), pole, parent=asset, role="goal_pole", segments=12, rings=8)
    # Three overlapping, softly bevelled strips form a chunky wind-swept flag.
    for index, (width, z, x) in enumerate(((0.34, 0.79, 0.17), (0.29, 0.70, 0.145), (0.23, 0.62, 0.115))):
        strip = base.bevelled_box(
            f"goal_flag_cloth_{index}", (width, 0.035, 0.105), (x, 0, z),
            cloth, bevel=0.018, parent=asset, role="goal_cloth",
        )
        strip.rotation_euler[1] = -0.06 * index
    return asset


def make_goal_lock() -> bpy.types.Object:
    asset = base.root("asset_goal_lock")
    body = mat("mat_goal_lock_body", "#6D5E8C", roughness=0.68, metallic=0.16)
    glow = mat(
        "mat_goal_lock_glow", "#D0B7FF", roughness=0.54,
        emissive="#7A43C3", emissive_strength=0.52,
    )
    base.bevelled_box("goal_lock_body", (0.32, 0.13, 0.24), (0, 0, 0.12), body, bevel=0.045, parent=asset, role="lock_body")
    base.torus(
        "goal_lock_shackle", 0.12, 0.032, (0, 0, 0.28), glow,
        parent=asset, rotation=(math.pi / 2, 0, 0), role="lock_glow",
    )
    base.sphere("goal_lock_keyhole", (0, -0.071, 0.13), (0.033, 0.016, 0.045), glow, parent=asset, role="lock_glow", segments=10, rings=8)
    return asset


def make_collapse_wall() -> bpy.types.Object:
    asset = base.root("asset_wall_collapse")
    body = mat("mat_wall_collapse_body", "#5A4335", roughness=0.98)
    accent = mat("mat_wall_collapse_accent", "#BF9A72", roughness=0.93)
    crack = mat("mat_wall_collapse_crack", "#2D241F", roughness=1.0)
    base.bevelled_box(
        "wall_collapse_body", (base.WALL_LENGTH, base.WALL_DEPTH, base.WALL_HEIGHT),
        (0, 0, base.WALL_HEIGHT / 2), body, bevel=0.03, parent=asset, role="wall_body",
    )
    for index, x in enumerate((-0.36, 0, 0.36)):
        base.bevelled_box(
            f"wall_collapse_patch_{index}", (0.19, base.WALL_DEPTH, 0.16),
            (x, 0, 0.15 + (index % 2) * 0.16), accent,
            bevel=0.018, parent=asset, role="wall_accent",
        )
    for side in (-1, 1):
        for index, (x, z, angle) in enumerate(((-0.24, 0.34, 0.5), (0.12, 0.23, -0.62), (0.34, 0.39, 0.35))):
            bar = base.bevelled_box(
                f"wall_collapse_crack_{side}_{index}", (0.15, 0.008, 0.022),
                (x, side * 0.076, z), crack, bevel=0.004, parent=asset, role="wall_crack",
            )
            bar.rotation_euler[1] = angle
    return asset


def make_mirror_wall() -> bpy.types.Object:
    asset = base.root("asset_wall_mirror")
    frame = mat("mat_wall_mirror_frame", "#52656D", roughness=0.36, metallic=0.58)
    body = mat("mat_wall_mirror_body", "#81959D", roughness=0.16, metallic=0.72)
    accent = mat(
        "mat_wall_mirror_accent", "#F2FBFB", roughness=0.1, metallic=0.64,
        emissive="#52676E", emissive_strength=0.12,
    )
    base.bevelled_box(
        "wall_mirror_frame", (base.WALL_LENGTH, base.WALL_DEPTH, base.WALL_HEIGHT),
        (0, 0, base.WALL_HEIGHT / 2), frame, bevel=0.028, parent=asset, role="wall_frame",
    )
    for side in (-1, 1):
        base.bevelled_box(
            f"wall_mirror_panel_{side}", (0.89, 0.008, 0.34),
            (0, side * 0.076, 0.25), body, bevel=0.025, parent=asset, role="wall_mirror",
        )
        for index, x in enumerate((-0.29, 0, 0.29)):
            base.bevelled_box(
                f"wall_mirror_glint_{side}_{index}", (0.06, 0.006, 0.21),
                (x, side * 0.077, 0.28), accent, bevel=0.01,
                parent=asset, role="wall_accent",
            )
    return asset


def make_legacy_seal_die() -> bpy.types.Object:
    asset = base.root("asset_legacy_seal_die")
    body = mat("mat_legacy_seal_die_body", "#FDF6E3", roughness=0.7)
    accent = mat(
        "mat_legacy_seal_die_accent", "#E879F9", roughness=0.62,
        emissive="#A21CAF", emissive_strength=0.55,
    )
    # Integrated floor seal and a hovering 0.30 die match the old marker's
    # silhouette while making every face a physical Blender pip channel.
    base.cylinder(
        "legacy_seal_floor", 0.265, 0.012, (0, 0, 0.006), body,
        parent=asset, vertices=24, role="seal_floor",
    )
    base.torus("legacy_seal_ring", 0.24, 0.044, (0, 0, 0.044), accent, parent=asset, role="seal_accent")
    side = 0.30
    bottom = 0.105
    base.bevelled_box(
        "legacy_seal_die_body", (side - 0.018, side - 0.018, side - 0.018),
        (0, 0, bottom + side / 2), body, bevel=0.045, parent=asset, role="die_body",
    )
    add_die_pips(asset, accent, side=side, bottom=bottom, prefix="legacy_seal_die")
    return asset


BUILDERS: dict[str, Callable[[], bpy.types.Object]] = {
    "wormhole-die": make_wormhole_die,
    "wormhole-board-base": make_wormhole_board_base,
    "wormhole-rock": make_wormhole_rock,
    "wormhole-target-pad": make_wormhole_target_pad,
    "wormhole-portal": make_wormhole_portal,
    "item-mine": make_item_mine,
    "item-mine-used": make_item_mine_used,
    "item-smoke": make_item_smoke,
    "item-smoke-used": make_item_smoke_used,
    "goal-flag": make_goal_flag,
    "goal-lock": make_goal_lock,
    "wall-collapse": make_collapse_wall,
    "wall-mirror": make_mirror_wall,
    "legacy-seal-die": make_legacy_seal_die,
}


MATERIAL_CONTRACTS = {
    "wormholeDie": {"body": "mat_wormhole_die_body", "pips": "mat_wormhole_die_pips"},
    "wormholeRock": {"emissive": "mat_wormhole_rock_accent"},
    "wormholeTargetPad": {"tintAndEmissive": "mat_wormhole_target_accent"},
    "wormholePortal": {"tintAndEmissive": "mat_wormhole_portal_accent", "core": "mat_wormhole_portal_core"},
    "itemMine": {"animatedEmissive": "mat_item_mine_lamp"},
    "itemSmoke": {"animatedEmissive": "mat_item_smoke_fuse"},
    "goalFlag": {"stateTint": "mat_goal_flag_cloth"},
    "goalLock": {"emissive": "mat_goal_lock_glow"},
    "legacySealDie": {"activatedTintAndEmissive": "mat_legacy_seal_die_accent"},
}


def parse_args() -> argparse.Namespace:
    argv = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", default="public/assets/maze/v1")
    return parser.parse_args(argv)


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    base.PACK_VERSION = PACK_VERSION

    manifest_path = output_dir / "manifest.json"
    assert manifest_path.exists(), (
        "v2 extension generation must run after the existing v1 pack so its base entries can be preserved"
    )
    existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    assert existing_manifest.get("version") == PACK_VERSION, "existing v1 manifest version drifted"
    assets: dict[str, object] = dict(existing_manifest.get("assets", {}))
    for key, builder in BUILDERS.items():
        base.reset_scene()
        asset = builder()
        base.join_by_material(asset)
        if key in {"wormhole-die", "legacy-seal-die"}:
            asset["daemok_die_base_faces"] = "1:+Y,6:-Y,2:-Z,5:+Z,3:+X,4:-X"
            asset["daemok_die_pip_count"] = 21
        material_names = sorted({
            material.name
            for obj in base.descendants(asset)
            if obj.type == "MESH"
            for material in obj.data.materials
            if material
        })
        destination = output_dir / f"{key}.glb"
        entry = base.export_asset(asset, destination)
        entry["materials"] = material_names
        assets[key] = entry
        print(f"generated {destination} ({entry['bytes']} bytes)")

    manifest = dict(existing_manifest)
    manifest.update({
        "version": PACK_VERSION,
        "generatorRevision": GENERATOR_REVISION,
        "coordinateSystem": "glTF Y-up; +Z forward; ground anchor at Y=0",
        "unitScale": 1,
        "tileSize": WORMHOLE_TILE_SIZE,
        "tileGap": WORMHOLE_GAP,
        "tileSpacing": WORMHOLE_SPACING,
        "wallLength": base.WALL_LENGTH,
        "wallHeight": base.WALL_HEIGHT,
        "wallDepth": base.WALL_DEPTH,
        "dieSide": DIE_SIDE,
        "dieCenterY": DIE_CENTER_HEIGHT,
        "dieBaseFaces": {"+Y": 1, "-Y": 6, "-Z": 2, "+Z": 5, "+X": 3, "-X": 4},
        "wormholeBoard": {
            "size": WORMHOLE_BOARD_SIZE,
            "gridSpan": WORMHOLE_GRID_SPAN,
            "origin": "grid center",
            "tileAssetRootY": WORMHOLE_TILE_ROOT_Y,
            "playableTopY": WORMHOLE_PLAYABLE_TOP_Y,
        },
        "runtimePlacement": {
            "mainTileSurfaceY": 0.08,
            "mainProps": "goal/items/portal/legacy seal roots at main-board Y=0.08",
            "walls": "root at main-board Y=0; local +X is H; rotate Y by PI/2 for V",
            "wormholeBoardBase": "root at wormhole-world Y=0; geometry spans Y=-0.46..-0.08; grid centered at X=0,Z=0",
            "wormholeBoardTiles": "reuse v1 tile-cream/tile-sage at root Y=-0.08",
            "wormholeBoardProps": "die/rock/target roots at playable surface Y=0.08",
            "dieOrientation": "neutral local faces: 1=+Y,6=-Y,2=-Z,5=+Z,3=+X,4=-X; animate parent quaternion",
        },
        "materialContracts": MATERIAL_CONTRACTS,
        "assets": assets,
    })
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {manifest_path}")


if __name__ == "__main__":
    main()
