// SPDX-License-Identifier: GPL-3.0-only
// Our direct adapter to the unmodified psd2live API.
package io.github.psd2live.directbust

import io.github.psd2live.core.*
import io.github.psd2live.posedump.dumpPreview
import java.nio.file.Path
import org.umamo.runtime.model.*

fun main(args: Array<String>) {
    require(args.size == 2) { "Expected prepared PSD and pose JSON output" }
    val config = PipelineConfig(
        meshSpacing = 24, headTurnStrength = .2f, bodyStrength = 0f,
        mouthOutlineEnabled = false, generatePhysics = false,
        exportMotions = false, exportCmo3 = false, exportMoc3 = false
    )
    val preview = PSD2LivePipeline().buildPreview(Path.of(args[0]), config)
    val sourceNames = preview.analysis.source.layers.associate { it.id.raw to it.name }
    // Composite measured mouth artwork must be invisible at the closed endpoint.
    // The engine otherwise flattens its texture into a second line over the source
    // mouth. This changes only opacity; head motion and mesh evaluation stay native.
    val drawables = preview.rig.puppet.drawables.map { drawable ->
        val name = sourceNames[preview.rig.layerIdByDrawableId[drawable.id.raw]]
        if (name != "mouth_open") drawable else {
            val grid = KeyformGrid<ChannelValue>(
                listOf(KeyformAxis(ParameterId("ParamMouthOpenY"), floatArrayOf(0f, .15f, 1f))),
                listOf(0f, 1f, 1f).mapIndexed { i, opacity ->
                    KeyformCell(intArrayOf(i), ChannelValue.Scalar(opacity)) })
            drawable.copy(channelGrids = ChannelGrids(drawable.channelGrids.gridsByChannel + (FormChannel.OPACITY to grid)))
        }
    }
    dumpPreview(preview.copy(rig = preview.rig.copy(puppet = preview.rig.puppet.copy(drawables = drawables))), Path.of(args[1]))
}
