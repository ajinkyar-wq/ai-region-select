"""
Fix the frozen crop in mobile_sam_decoder.onnx.

The exported decoder hardcodes its un-pad crop to a fixed rectangle of
height=683, width=1024 (the values for a 1500x1000 / 3:2 image). Its
postprocess is:

    low_res 256x256 -> Resize 1024x1024 -> Slice[0:683, 0:1024] -> Resize orig_im_size

Because the crop is frozen, the decoder is only geometrically correct for
3:2 landscape images. Every other aspect ratio gets a linear vertical skew
(the model treats black padding rows as image, then stretches).

This script does graph surgery: it replaces the two hardcoded Slice `ends`
constants (683 on axis 2, 1024 on axis 3) with values computed dynamically
from the `orig_im_size` input, reproducing the correct longest-side un-pad:

    crop_h = floor(OH * 1024 / max(OH, OW))
    crop_w = floor(OW * 1024 / max(OH, OW))

All trained weights are untouched.
"""
import sys
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

SRC = "public/model/mobile_sam_decoder.onnx"
DST = "public/model/mobile_sam_decoder.onnx"  # in-place; back up first


def const(name, arr):
    return helper.make_node(
        "Constant", [], [name],
        value=numpy_helper.from_array(np.asarray(arr), name + "_v"),
    )


def main():
    m = onnx.load(SRC)
    g = m.graph

    # All inserted nodes, in producer-before-consumer order.
    # orig_im_size is float32 [2] = [OH, OW].
    nodes = [
        # index constants for gather (scalars)
        const("fix_oh_idx", np.array(0, dtype=np.int64)),
        const("fix_ow_idx", np.array(1, dtype=np.int64)),
        const("fix_axis0", np.array([0], dtype=np.int64)),
        const("fix_1024s", np.array(1024.0, dtype=np.float32)),
        # OH, OW (scalars)
        helper.make_node("Gather", ["orig_im_size", "fix_oh_idx"], ["fix_OH"]),
        helper.make_node("Gather", ["orig_im_size", "fix_ow_idx"], ["fix_OW"]),
        # longest = max(OH, OW); scale = 1024 / longest
        helper.make_node("Max", ["fix_OH", "fix_OW"], ["fix_long"]),
        helper.make_node("Div", ["fix_1024s", "fix_long"], ["fix_scale"]),
        # crop_h = floor(OH * scale), crop_w = floor(OW * scale)
        helper.make_node("Mul", ["fix_OH", "fix_scale"], ["fix_ch_f"]),
        helper.make_node("Mul", ["fix_OW", "fix_scale"], ["fix_cw_f"]),
        helper.make_node("Floor", ["fix_ch_f"], ["fix_ch_fl"]),
        helper.make_node("Floor", ["fix_cw_f"], ["fix_cw_fl"]),
        helper.make_node("Cast", ["fix_ch_fl"], ["fix_ch_i"], to=TensorProto.INT64),
        helper.make_node("Cast", ["fix_cw_fl"], ["fix_cw_i"], to=TensorProto.INT64),
        # Slice `ends` must be 1-D tensors of length 1.
        helper.make_node("Unsqueeze", ["fix_ch_i", "fix_axis0"], ["fix_ch_ends"]),
        helper.make_node("Unsqueeze", ["fix_cw_i", "fix_axis0"], ["fix_cw_ends"]),
    ]

    # --- rewire the two crop Slices ---
    # Slice_8 = crop axis 2 (height): replace its `ends` (input[2], was Constant 683).
    # Slice_9 = crop axis 3 (width):  replace its `ends` (input[2], was Constant 1024).
    patched = 0
    for n in g.node:
        if n.op_type != "Slice":
            continue
        if n.name == "/Slice_8":
            n.input[2] = "fix_ch_ends"
            patched += 1
        elif n.name == "/Slice_9":
            n.input[2] = "fix_cw_ends"
            patched += 1
    if patched != 2:
        sys.exit(f"expected to patch 2 slices, patched {patched}")

    # Prepend our compute nodes (topo order: constants/derived before Slices).
    existing = list(g.node)
    del g.node[:]
    g.node.extend(nodes + existing)

    # Resort topologically so the inserted nodes referencing graph inputs are valid.
    onnx.checker.check_model(m, full_check=False)
    onnx.save(m, DST)
    print(f"patched {patched} slices; wrote {DST}")


if __name__ == "__main__":
    main()
