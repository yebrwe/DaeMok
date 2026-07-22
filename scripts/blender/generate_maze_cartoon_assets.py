#!/usr/bin/env python3
"""Generate DaeMok's small, texture-free cartoon GLB asset pack.

Run from the repository root:

    blender --background --factory-startup \
      --python scripts/blender/generate_maze_cartoon_assets.py -- \
      --output-dir public/assets/maze/v1

The source scene uses Blender's Z-up convention. Blender's glTF exporter writes
Y-up GLBs, so Blender -Y becomes the model's +Z (the pawn's forward direction
inside Three.js). Every asset is ground-anchored and uses metre-like game units:
one board tile is exactly 1.0 x 1.0.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import sys
from pathlib import Path
from typing import Callable

import bpy
from mathutils import Vector


PACK_VERSION = 1
TILE_SIZE = 1.0
TILE_HEIGHT = 0.16
WALL_LENGTH = 1.084
WALL_HEIGHT = 0.5
WALL_DEPTH = 0.16
BOARD_SIZE = 6
BOARD_SPACING = 1.14
BOARD_SPAN = BOARD_SIZE * BOARD_SPACING - 0.14

PALETTE = {
    "cream": "#FFF5D9",
    "sage": "#DCE9BE",
    "sage_dark": "#557568",
    "wood_red": "#7D2825",
    "wood_light": "#B8553F",
    "ink": "#2B211B",
    "rabbit": "#F0D6AD",
    "rabbit_cream": "#FFF0D2",
    "rabbit_pink": "#EFA5A0",
    "cape": "#6E9B45",
    "player_accent": "#2E9FC4",
    "steel": "#526579",
    "steel_light": "#D7E1E8",
    "fire": "#D94B2B",
    "fire_light": "#FFC43D",
    "poison": "#4D8B21",
    "poison_light": "#B7E33F",
    "ice": "#3BA7C4",
    "ice_light": "#E8FBFF",
    "wind": "#168AA3",
    "wind_light": "#E5FBFF",
    "phase": "#7048B6",
    "phase_light": "#EB62C1",
    "thorn": "#8A3044",
    "thorn_light": "#FF9D94",
    "crystal": "#008E83",
    "crystal_light": "#F064B5",
    "fog": "#8393A3",
    "fog_light": "#D9F7FB",
    "illusion": "#6D28D9",
    "illusion_light": "#67E8F9",
}


def hex_rgba(value: str, alpha: float = 1.0) -> tuple[float, float, float, float]:
    value = value.removeprefix("#")
    return tuple(int(value[i : i + 2], 16) / 255 for i in (0, 2, 4)) + (alpha,)


def reset_scene() -> None:
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials):
        for block in list(datablocks):
            datablocks.remove(block)


def material(
    name: str,
    color: str,
    *,
    roughness: float = 0.82,
    metallic: float = 0.0,
    emissive: str | None = None,
    emissive_strength: float = 0.0,
) -> bpy.types.Material:
    mat = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    mat.diffuse_color = hex_rgba(color)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = hex_rgba(color)
    bsdf.inputs["Roughness"].default_value = roughness
    bsdf.inputs["Metallic"].default_value = metallic
    if emissive:
        emission_input = bsdf.inputs.get("Emission Color") or bsdf.inputs.get("Emission")
        strength_input = bsdf.inputs.get("Emission Strength")
        if emission_input:
            emission_input.default_value = hex_rgba(emissive)
        if strength_input:
            strength_input.default_value = emissive_strength
    return mat


def tag(obj: bpy.types.Object, role: str) -> bpy.types.Object:
    obj["daemok_role"] = role
    return obj


def root(name: str) -> bpy.types.Object:
    obj = bpy.data.objects.new(name, None)
    bpy.context.collection.objects.link(obj)
    obj["daemok_asset_version"] = PACK_VERSION
    obj["daemok_asset_key"] = name.removeprefix("asset_")
    return obj


def parent_to(obj: bpy.types.Object, parent: bpy.types.Object) -> bpy.types.Object:
    obj.parent = parent
    return obj


def apply_mesh_transform(obj: bpy.types.Object) -> None:
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    obj.select_set(False)


def smooth(obj: bpy.types.Object) -> None:
    if obj.type == "MESH":
        for poly in obj.data.polygons:
            poly.use_smooth = True


def normalize_asset_height(asset: bpy.types.Object, target_height: float) -> None:
    """Bake an exact world-space height and ground anchor into joined meshes."""
    meshes = [obj for obj in descendants(asset) if obj.type == "MESH"]
    points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    lower_z = min(point.z for point in points)
    upper_z = max(point.z for point in points)
    factor = target_height / (upper_z - lower_z)
    for obj in meshes:
        inverse = obj.matrix_world.inverted()
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            world.x *= factor
            world.y *= factor
            world.z = (world.z - lower_z) * factor
            vertex.co = inverse @ world
        obj.data.update()


def join_by_material(asset: bpy.types.Object) -> None:
    """Collapse same-material details into stable geometry channels.

    A tile becomes two draw calls (body + inset), and the rabbit becomes one
    mesh per semantic material instead of one draw call per primitive.
    """
    groups: dict[str, list[bpy.types.Object]] = {}
    for obj in descendants(asset):
        if obj.type != "MESH" or len(obj.data.materials) != 1:
            continue
        mat = obj.data.materials[0]
        groups.setdefault(mat.name, []).append(obj)

    for material_name in sorted(groups):
        objects = sorted(groups[material_name], key=lambda obj: obj.name)
        bpy.ops.object.select_all(action="DESELECT")
        active = objects[0]
        for obj in objects:
            obj.select_set(True)
        bpy.context.view_layer.objects.active = active
        if len(objects) > 1:
            bpy.ops.object.join()
        channel = material_name.removeprefix("mat_")
        active.name = f"mesh_{channel}"
        active.data.name = f"geo_{channel}"
        active["daemok_material_channel"] = material_name
        active["daemok_role"] = "player_accent" if material_name == "mat_rabbit_player_accent" else channel


def bevelled_box(
    name: str,
    dimensions: tuple[float, float, float],
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    bevel: float = 0.03,
    parent: bpy.types.Object,
    role: str = "body",
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cube_add(location=location)
    obj = bpy.context.object
    obj.name = name
    obj.dimensions = dimensions
    apply_mesh_transform(obj)
    if bevel > 0:
        modifier = obj.modifiers.new("soft_cartoon_edges", "BEVEL")
        modifier.width = bevel
        modifier.segments = 2
        modifier.limit_method = "ANGLE"
        bpy.context.view_layer.objects.active = obj
        bpy.ops.object.modifier_apply(modifier=modifier.name)
    obj.data.materials.append(mat)
    return tag(parent_to(obj, parent), role)


def sphere(
    name: str,
    location: tuple[float, float, float],
    scale: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    role: str = "detail",
    segments: int = 16,
    rings: int = 10,
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=rings, location=location)
    obj = bpy.context.object
    obj.name = name
    obj.scale = scale
    apply_mesh_transform(obj)
    smooth(obj)
    obj.data.materials.append(mat)
    return tag(parent_to(obj, parent), role)


def cylinder(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    vertices: int = 12,
    rotation: tuple[float, float, float] = (0, 0, 0),
    role: str = "detail",
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cylinder_add(
        vertices=vertices, radius=radius, depth=depth, location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    smooth(obj)
    obj.data.materials.append(mat)
    return tag(parent_to(obj, parent), role)


def cone(
    name: str,
    radius: float,
    depth: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    vertices: int = 7,
    rotation: tuple[float, float, float] = (0, 0, 0),
    role: str = "detail",
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_cone_add(
        vertices=vertices, radius1=radius, radius2=0, depth=depth,
        location=location, rotation=rotation
    )
    obj = bpy.context.object
    obj.name = name
    obj.data.materials.append(mat)
    return tag(parent_to(obj, parent), role)


def torus(
    name: str,
    major_radius: float,
    minor_radius: float,
    location: tuple[float, float, float],
    mat: bpy.types.Material,
    *,
    parent: bpy.types.Object,
    rotation: tuple[float, float, float] = (0, 0, 0),
    role: str = "detail",
) -> bpy.types.Object:
    bpy.ops.mesh.primitive_torus_add(
        major_radius=major_radius, minor_radius=minor_radius,
        major_segments=16, minor_segments=6,
        location=location, rotation=rotation,
    )
    obj = bpy.context.object
    obj.name = name
    smooth(obj)
    obj.data.materials.append(mat)
    return tag(parent_to(obj, parent), role)


def make_rabbit() -> bpy.types.Object:
    asset = root("asset_rabbit_pawn")
    fur = material("mat_rabbit_fur", PALETTE["rabbit"], roughness=0.86)
    cream = material("mat_rabbit_cream", PALETTE["rabbit_cream"], roughness=0.9)
    pink = material("mat_rabbit_ear", PALETTE["rabbit_pink"], roughness=0.88)
    ink = material("mat_rabbit_ink", PALETTE["ink"], roughness=0.95)
    white = material("mat_rabbit_eye_white", "#FFFDF7", roughness=0.95)
    cape = material("mat_rabbit_cape", PALETTE["cape"], roughness=0.84)
    accent = material("mat_rabbit_player_accent", PALETTE["player_accent"], roughness=0.68)

    # The approved cream fur and leaf-green cape stay fixed. Multiplayer color
    # only changes the tiny compass clasp named mat_rabbit_player_accent.
    sphere("rabbit_cape", (0, 0.125, 0.41), (0.235, 0.065, 0.28), cape, parent=asset, role="fixed_cape")
    sphere("rabbit_body", (0, 0.01, 0.34), (0.23, 0.19, 0.28), fur, parent=asset, role="fixed_fur")
    sphere("rabbit_belly", (0, -0.172, 0.35), (0.145, 0.035, 0.19), cream, parent=asset)
    sphere("rabbit_head", (0, -0.005, 0.64), (0.205, 0.19, 0.19), fur, parent=asset, role="fixed_fur")
    # Long, slightly splayed ears; their broad face points toward Blender -Y / Three +Z.
    left_ear = sphere("rabbit_ear_left", (-0.105, 0.015, 0.91), (0.085, 0.055, 0.245), fur, parent=asset, role="fixed_fur")
    right_ear = sphere("rabbit_ear_right", (0.105, 0.015, 0.91), (0.085, 0.055, 0.245), fur, parent=asset, role="fixed_fur")
    left_ear.rotation_euler[1] = -0.17
    right_ear.rotation_euler[1] = 0.17
    for x, tilt in ((-0.105, -0.17), (0.105, 0.17)):
        inner = sphere(f"rabbit_ear_inner_{'l' if x < 0 else 'r'}", (x, -0.051, 0.915), (0.043, 0.018, 0.165), pink, parent=asset)
        inner.rotation_euler[1] = tilt
    # Face: deliberately oversized for 48-64 px board readability.
    sphere("rabbit_muzzle", (0, -0.174, 0.596), (0.105, 0.055, 0.075), cream, parent=asset)
    for x in (-0.068, 0.068):
        sphere(f"rabbit_eye_white_{x:+.3f}", (x, -0.174, 0.68), (0.045, 0.025, 0.057), white, parent=asset)
        sphere(f"rabbit_pupil_{x:+.3f}", (x, -0.199, 0.677), (0.021, 0.012, 0.028), ink, parent=asset)
    sphere("rabbit_nose", (0, -0.238, 0.617), (0.032, 0.018, 0.025), pink, parent=asset)
    # Arms, feet and visible round tail.
    for x, rot in ((-0.205, -0.32), (0.205, 0.32)):
        arm = sphere(f"rabbit_arm_{'l' if x < 0 else 'r'}", (x, -0.025, 0.38), (0.07, 0.065, 0.16), fur, parent=asset, role="fixed_fur")
        arm.rotation_euler[1] = rot
    for x in (-0.115, 0.115):
        sphere(f"rabbit_foot_{'l' if x < 0 else 'r'}", (x, -0.09, 0.07), (0.13, 0.18, 0.07), cream, parent=asset)
    sphere("rabbit_tail", (0, 0.19, 0.39), (0.11, 0.105, 0.11), cream, parent=asset)
    torus("rabbit_cape_collar", 0.155, 0.035, (0, 0, 0.51), cape, parent=asset, role="fixed_cape")
    # Small compass-like clasp on the front. This is the only player-tinted mesh.
    cylinder(
        "rabbit_player_clasp", 0.052, 0.025, (0, -0.211, 0.5), accent,
        parent=asset, vertices=12, rotation=(math.pi / 2, 0, 0), role="player_accent",
    )
    cone(
        "rabbit_player_clasp_needle", 0.018, 0.052, (0, -0.229, 0.505), accent,
        parent=asset, vertices=4, rotation=(math.pi / 2, 0, 0), role="player_accent",
    )
    return asset


def make_marker(key: str, color: str, accent_color: str) -> bpy.types.Object:
    asset = root(f"asset_marker_{key}")
    body = material(f"mat_marker_{key}_body", color, roughness=0.82)
    accent = material(f"mat_marker_{key}_accent", accent_color, roughness=0.72)
    # Root is Y=0 after glTF conversion. Place the root at the existing tile top
    # (Three.js y=0.08); the seal itself rises just 0.045 units above it.
    cylinder("marker_medallion", 0.32, 0.045, (0, 0, 0.0225), body, parent=asset, vertices=24, role="marker_body")
    torus("marker_inset_ring", 0.235, 0.025, (0, 0, 0.051), accent, parent=asset, role="marker_accent")
    if key == "start":
        for index, y in enumerate((-0.09, 0.0, 0.09)):
            arrow = cone(
                f"marker_start_leaf_{index}", 0.045, 0.11, (0, y, 0.055), accent,
                parent=asset, vertices=5, rotation=(0, math.pi / 2, 0), role="marker_accent",
            )
            arrow.scale.x = 0.7
    else:
        # A chunky four-point goal seal remains legible below the procedural flag.
        bevelled_box("marker_goal_cross_x", (0.25, 0.065, 0.025), (0, 0, 0.062), accent, bevel=0.018, parent=asset, role="marker_accent")
        bevelled_box("marker_goal_cross_y", (0.065, 0.25, 0.025), (0, 0, 0.062), accent, bevel=0.018, parent=asset, role="marker_accent")
    return asset


def make_tile(key: str, color: str) -> bpy.types.Object:
    asset = root(f"asset_tile_{key}")
    body = material(f"mat_tile_{key}", color, roughness=0.92)
    inset = material(f"mat_tile_{key}_inset", "#D7C9A8" if key == "cream" else "#AFC58B", roughness=0.95)
    bevelled_box("tile_body", (TILE_SIZE, TILE_SIZE, TILE_HEIGHT), (0, 0, TILE_HEIGHT / 2), body, bevel=0.055, parent=asset, role="tile_body")
    # Four tiny corner dimples give the tile a hand-made board-game read without textures.
    for index, (x, y) in enumerate(((-0.37, -0.37), (-0.37, 0.37), (0.37, -0.37), (0.37, 0.37))):
        cylinder(f"tile_dimple_{index}", 0.018, 0.008, (x, y, TILE_HEIGHT + 0.002), inset, parent=asset, vertices=8)
    return asset


def make_board_base() -> bpy.types.Object:
    asset = root("asset_board_base")
    upper = material("mat_board_base_sage", "#C7D7B3", roughness=0.94)
    lower = material("mat_board_base_dark", PALETTE["sage_dark"], roughness=0.98)
    # Preserve the current board's exact vertical contract: tiles are centred
    # on Y=0, their bottom is -0.08, and the base ends at that same seam.
    bevelled_box("board_base_lower", (BOARD_SPAN + 1.0, BOARD_SPAN + 1.0, 0.12), (0, 0, -0.40), lower, bevel=0.05, parent=asset, role="board_base")
    bevelled_box("board_base_upper", (BOARD_SPAN + 0.7, BOARD_SPAN + 0.7, 0.28), (0, 0, -0.22), upper, bevel=0.12, parent=asset, role="board_base")
    return asset


def wall_shell(asset_key: str, body_color: str, cap_color: str) -> tuple[bpy.types.Object, bpy.types.Material, bpy.types.Material]:
    asset = root(f"asset_wall_{asset_key}")
    body = material(f"mat_wall_{asset_key}_body", body_color, roughness=0.88)
    cap = material(f"mat_wall_{asset_key}_accent", cap_color, roughness=0.78)
    bevelled_box("wall_body", (WALL_LENGTH, WALL_DEPTH, WALL_HEIGHT), (0, 0, WALL_HEIGHT / 2), body, bevel=0.035, parent=asset, role="wall_body")
    bevelled_box("wall_cap", (WALL_LENGTH * 0.9, WALL_DEPTH * 0.72, 0.055), (0, 0, WALL_HEIGHT + 0.017), cap, bevel=0.018, parent=asset, role="wall_accent")
    return asset, body, cap


def make_normal_wall() -> bpy.types.Object:
    # A discovered ordinary wall must read as one unmistakable red block.
    # Decorative caps/seams made it look like another special-wall subtype and
    # also gave fake walls an avoidable visual fingerprint.
    asset = root("asset_wall_normal")
    body = material("mat_wall_normal_body", "#8B1E24", roughness=0.9)
    bevelled_box(
        "wall_normal_block",
        (WALL_LENGTH, WALL_DEPTH, WALL_HEIGHT),
        (0, 0, WALL_HEIGHT / 2),
        body,
        bevel=0.035,
        parent=asset,
        role="wall_body",
    )
    return asset


def make_steel_wall() -> bpy.types.Object:
    asset, _, accent = wall_shell("steel", PALETTE["steel"], PALETTE["steel_light"])
    dark = material("mat_wall_steel_dark", "#2E3B49", roughness=0.76, metallic=0.1)
    for x in (-0.36, 0, 0.36):
        cylinder(f"steel_rivet_top_{x:+.2f}", 0.042, 0.035, (x, 0, 0.56), accent, parent=asset, vertices=10)
    for side in (-1, 1):
        bevelled_box(f"steel_brace_{side}", (0.07, WALL_DEPTH + 0.018, 0.42), (side * 0.39, 0, 0.26), dark, bevel=0.012, parent=asset)
    return asset


def make_fire_wall() -> bpy.types.Object:
    asset, _, flame = wall_shell("fire", "#8F2D27", PALETTE["fire_light"])
    ember = material("mat_wall_fire_ember", PALETTE["fire"], roughness=0.72, emissive="#C73520", emissive_strength=0.35)
    for index, x in enumerate((-0.32, -0.1, 0.13, 0.34)):
        height = (0.24, 0.34, 0.28, 0.22)[index]
        cone(f"fire_flame_outer_{index}", 0.09, height, (x, 0, WALL_HEIGHT + height / 2), ember, parent=asset, vertices=7)
        cone(f"fire_flame_inner_{index}", 0.045, height * 0.55, (x, -0.01, WALL_HEIGHT + height * 0.36), flame, parent=asset, vertices=7)
    return asset


def make_poison_wall() -> bpy.types.Object:
    asset, _, ooze = wall_shell("poison", "#355F22", PALETTE["poison_light"])
    bubble = material("mat_wall_poison_bubble", PALETTE["poison"], roughness=0.76, emissive="#3F741B", emissive_strength=0.14)
    for index, (x, z, radius) in enumerate(((-0.33, 0.45, 0.07), (-0.06, 0.57, 0.055), (0.2, 0.46, 0.08), (0.38, 0.6, 0.045))):
        sphere(f"poison_bubble_{index}", (x, 0, z), (radius, radius, radius), bubble, parent=asset)
    for side in (-1, 1):
        sphere(f"poison_ooze_{side}", (side * 0.23, -WALL_DEPTH / 2 - 0.02, 0.31), (0.14, 0.035, 0.11), ooze, parent=asset)
    return asset


def make_ice_wall() -> bpy.types.Object:
    asset, _, pale = wall_shell("ice", PALETTE["ice"], PALETTE["ice_light"])
    blue = material("mat_wall_ice_crystal", "#80DAEC", roughness=0.42, metallic=0.04)
    for index, (x, height, radius) in enumerate(((-0.34, 0.22, 0.07), (-0.12, 0.35, 0.09), (0.15, 0.28, 0.08), (0.36, 0.19, 0.065))):
        cone(f"ice_crystal_{index}", radius, height, (x, 0, WALL_HEIGHT + height / 2), blue if index % 2 else pale, parent=asset, vertices=6)
    return asset


def make_wind_wall() -> bpy.types.Object:
    asset = root("asset_wall_wind")
    blue = material("mat_wall_wind_body", PALETTE["wind"], roughness=0.8)
    pale = material("mat_wall_wind_accent", PALETTE["wind_light"], roughness=0.9)
    # Open geometry avoids alpha sorting and keeps the silhouette readable.
    for x in (-WALL_LENGTH / 2 + 0.065, WALL_LENGTH / 2 - 0.065):
        cylinder(f"wind_post_{x:+.2f}", 0.05, WALL_HEIGHT, (x, 0, WALL_HEIGHT / 2), blue, parent=asset, vertices=10)
    for index, (z, scale_x) in enumerate(((0.25, 0.72), (0.39, 0.88), (0.53, 0.62))):
        swoosh = torus(f"wind_swoosh_{index}", 0.21, 0.035, ((index - 1) * 0.22, 0, z), pale if index == 1 else blue, parent=asset, rotation=(math.pi / 2, 0, 0))
        swoosh.scale.x = scale_x
    return asset


def make_phase_wall() -> bpy.types.Object:
    asset = root("asset_wall_phase")
    purple = material("mat_wall_phase_body", PALETTE["phase"], roughness=0.72, emissive="#593296", emissive_strength=0.18)
    pink = material("mat_wall_phase_accent", PALETTE["phase_light"], roughness=0.7, emissive="#B13B91", emissive_strength=0.16)
    for x in (-WALL_LENGTH / 2 + 0.07, WALL_LENGTH / 2 - 0.07):
        cylinder(f"phase_post_{x:+.2f}", 0.065, WALL_HEIGHT, (x, 0, WALL_HEIGHT / 2), purple, parent=asset, vertices=8)
    for index, (x, z, length) in enumerate(((-0.28, 0.16, 0.33), (0.18, 0.30, 0.46), (-0.1, 0.46, 0.52))):
        bevelled_box(f"phase_float_{index}", (length, WALL_DEPTH * 0.7, 0.075), (x, 0, z), pink if index == 1 else purple, bevel=0.018, parent=asset)
    return asset


def make_thorn_wall() -> bpy.types.Object:
    asset, _, thorn = wall_shell("thorn", PALETTE["thorn"], PALETTE["thorn_light"])
    vine = material("mat_wall_thorn_vine", "#405C2A", roughness=0.94)
    for index, x in enumerate((-0.38, -0.19, 0, 0.19, 0.38)):
        cylinder(f"thorn_vine_{index}", 0.027, 0.44, (x, -WALL_DEPTH / 2 - 0.02, 0.28), vine, parent=asset, vertices=8)
        direction = -1 if index % 2 else 1
        cone(f"thorn_spike_{index}", 0.055, 0.18, (x, direction * 0.04, 0.59), thorn, parent=asset, vertices=6)
    return asset


def make_crystal_wall() -> bpy.types.Object:
    asset, _, pink = wall_shell("crystal", PALETTE["crystal"], PALETTE["crystal_light"])
    aqua = material("mat_wall_crystal_aqua", "#54D5C7", roughness=0.45, emissive="#006C65", emissive_strength=0.2)
    for index, (x, height, radius) in enumerate(((-0.36, 0.24, 0.08), (-0.13, 0.38, 0.1), (0.14, 0.3, 0.085), (0.37, 0.2, 0.07))):
        cone(f"crystal_shard_{index}", radius, height, (x, 0, WALL_HEIGHT + height / 2), pink if index in (1, 3) else aqua, parent=asset, vertices=6)
    return asset


def make_fog_wall() -> bpy.types.Object:
    asset = root("asset_wall_fog")
    mist = material("mat_wall_fog_mist", PALETTE["fog"], roughness=0.96)
    pale = material(
        "mat_wall_fog_glow",
        PALETTE["fog_light"],
        roughness=0.86,
        emissive="#4F7E8D",
        emissive_strength=0.12,
    )
    # End posts preserve the exact wall-slot silhouette while the soft,
    # staggered cloud clusters make this pass-through wall read as fog.
    for x in (-WALL_LENGTH / 2 + 0.05, WALL_LENGTH / 2 - 0.05):
        cylinder(
            f"fog_post_{x:+.2f}", 0.05, WALL_HEIGHT, (x, 0, WALL_HEIGHT / 2),
            mist, parent=asset, vertices=10, role="wall_body",
        )
    cloud_specs = (
        (-0.32, -0.01, 0.17, 0.21, 0.075, 0.12),
        (-0.12, 0.01, 0.31, 0.25, 0.085, 0.14),
        (0.14, -0.015, 0.2, 0.24, 0.07, 0.13),
        (0.34, 0.012, 0.38, 0.19, 0.075, 0.11),
        (0.03, 0.0, 0.49, 0.22, 0.065, 0.09),
    )
    for index, (x, y, z, sx, sy, sz) in enumerate(cloud_specs):
        sphere(
            f"fog_cloud_{index}", (x, y, z), (sx, sy, sz),
            pale if index in (1, 4) else mist,
            parent=asset, segments=12, rings=8, role="wall_accent",
        )
    return asset


def make_illusion_wall() -> bpy.types.Object:
    asset = root("asset_wall_illusion")
    purple = material(
        "mat_wall_illusion_body",
        PALETTE["illusion"],
        roughness=0.58,
        emissive="#7E22CE",
        emissive_strength=0.28,
    )
    cyan = material(
        "mat_wall_illusion_echo",
        PALETTE["illusion_light"],
        roughness=0.48,
        emissive="#0E7490",
        emissive_strength=0.32,
    )
    for x in (-WALL_LENGTH / 2 + 0.05, WALL_LENGTH / 2 - 0.05):
        cylinder(
            f"illusion_post_{x:+.2f}", 0.05, WALL_HEIGHT, (x, 0, WALL_HEIGHT / 2),
            purple, parent=asset, vertices=8, role="wall_body",
        )
    # Three offset echoes are a direct visual shorthand for the three-action
    # duration. The cyan ring reads as the fixed return point.
    for index, (x, y, z, length) in enumerate((
        (-0.18, -0.025, 0.15, 0.58),
        (0.14, 0.025, 0.29, 0.66),
        (-0.08, -0.015, 0.43, 0.72),
    )):
        bevelled_box(
            f"illusion_echo_{index}", (length, WALL_DEPTH * 0.52, 0.075),
            (x, y, z), cyan if index == 1 else purple,
            bevel=0.018, parent=asset, role="wall_accent",
        )
    torus(
        "illusion_return_ring", 0.16, 0.025, (0.04, -0.015, 0.3), cyan,
        parent=asset, rotation=(math.pi / 2, 0, 0), role="wall_accent",
    )
    return asset


BUILDERS: dict[str, Callable[[], bpy.types.Object]] = {
    "rabbit-pawn": make_rabbit,
    "tile-cream": lambda: make_tile("cream", PALETTE["cream"]),
    "tile-sage": lambda: make_tile("sage", PALETTE["sage"]),
    "board-base": make_board_base,
    "marker-start": lambda: make_marker("start", "#39BDB8", "#E6FFEF"),
    "marker-goal": lambda: make_marker("goal", "#E7655D", "#FFF0D2"),
    "wall-normal": make_normal_wall,
    "wall-steel": make_steel_wall,
    "wall-fire": make_fire_wall,
    "wall-poison": make_poison_wall,
    "wall-ice": make_ice_wall,
    "wall-wind": make_wind_wall,
    "wall-phase": make_phase_wall,
    "wall-thorn": make_thorn_wall,
    "wall-crystal": make_crystal_wall,
    "wall-fog": make_fog_wall,
    "wall-illusion": make_illusion_wall,
}


def descendants(obj: bpy.types.Object) -> list[bpy.types.Object]:
    result = [obj]
    for child in sorted(obj.children, key=lambda item: item.name):
        result.extend(descendants(child))
    return result


def mesh_stats(asset: bpy.types.Object) -> dict[str, int | list[float]]:
    objects = descendants(asset)
    meshes = [obj for obj in objects if obj.type == "MESH"]
    points: list[Vector] = []
    for obj in meshes:
        points.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
    if points:
        lower = [min(point[i] for point in points) for i in range(3)]
        upper = [max(point[i] for point in points) for i in range(3)]
    else:
        lower = upper = [0.0, 0.0, 0.0]
    return {
        "objects": len(objects),
        "meshes": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "triangles": sum(len(obj.data.loop_triangles) or sum(max(1, len(poly.vertices) - 2) for poly in obj.data.polygons) for obj in meshes),
        "bounds_blender_xyz": [round(value, 4) for value in (*lower, *upper)],
    }


def export_asset(asset: bpy.types.Object, destination: Path) -> dict[str, object]:
    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    selected = descendants(asset)
    for obj in selected:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = asset
    stats = mesh_stats(asset)
    bpy.ops.export_scene.gltf(
        filepath=str(destination),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_yup=True,
        export_materials="EXPORT",
        export_animations=False,
        export_extras=True,
        export_cameras=False,
        export_lights=False,
        export_texcoords=False,
        export_tangents=False,
        export_attributes=False,
        export_shared_accessors=True,
        check_existing=False,
    )
    payload = destination.read_bytes()
    return {
        **stats,
        "file": destination.name,
        "bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "root": asset.name,
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
    assets: dict[str, object] = {}
    for key, builder in BUILDERS.items():
        reset_scene()
        asset = builder()
        join_by_material(asset)
        if key == "rabbit-pawn":
            normalize_asset_height(asset, 0.92)
        destination = output_dir / f"{key}.glb"
        assets[key] = export_asset(asset, destination)
        print(f"generated {destination} ({assets[key]['bytes']} bytes)")

    manifest = {
        "version": PACK_VERSION,
        "coordinateSystem": "glTF Y-up; +Z forward; ground anchor at Y=0",
        "unitScale": 1,
        "tileSize": TILE_SIZE,
        "tileHeight": TILE_HEIGHT,
        "wallLength": WALL_LENGTH,
        "wallHeight": WALL_HEIGHT,
        "wallDepth": WALL_DEPTH,
        "runtimePlacement": {
            "rabbitAndWalls": "place root at board surface Y=0",
            "tiles": "place root at Y=-0.08 so the tile centre remains Y=0",
            "boardBase": "place root at Y=0; geometry already spans Y=-0.46..-0.08",
            "markers": "place root at tile top Y=0.08",
            "wallOrientation": "local +X is horizontal; rotate around Y by PI/2 for vertical segments",
        },
        "assets": assets,
    }
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"generated {manifest_path}")


if __name__ == "__main__":
    main()
