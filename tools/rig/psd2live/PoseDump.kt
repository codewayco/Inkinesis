// SPDX-License-Identifier: GPL-3.0-only
// Compiled only in the separately pinned GPL psd2live process. No Cubism Core.
package io.github.psd2live.posedump

import io.github.psd2live.core.PSD2LivePipeline
import io.github.psd2live.core.PipelineConfig
import io.github.psd2live.core.RigPreviewModel
import org.umamo.render.eval.CpuDeformationEvaluator
import org.umamo.runtime.model.Deformer
import org.umamo.runtime.model.ParameterId
import kotlinx.serialization.json.*
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO

fun dumpPoses(psd: Path, config: PipelineConfig, out: Path) =
    dumpPreview(PSD2LivePipeline().buildPreview(psd, config), out)

/** Preserve native meshes, atlas pixels, every authored axis key and the coupled head lattice. */
fun dumpPreview(preview: RigPreviewModel, out: Path) {
    Files.createDirectories(out.parent)
    val puppet = preview.rig.puppet
    val evaluator = CpuDeformationEvaluator()
    val defaults = evaluator.evaluate(puppet, emptyMap())
    val layers = preview.analysis.source.layers.associateBy { it.id.raw }
    val grids = puppet.drawables.flatMap { listOfNotNull(it.geometryGrid) + it.channelGrids.gridsByChannel.values } +
        puppet.deformers.flatMap { d ->
            val geometry = when (d) { is Deformer.Warp -> d.geometryGrid; is Deformer.Rotation -> d.geometryGrid }
            listOfNotNull(geometry) + d.channelGrids.gridsByChannel.values
        }
    fun keys(id: ParameterId): List<Float> {
        val p = puppet.parameters.first { it.id == id }
        return (listOf(p.min, p.default, p.max) + grids.flatMap { g ->
            g.axes.filter { it.parameterId == id }.flatMap { it.keys.toList() }
        }).filter { it >= p.min && it <= p.max }.distinct().sorted()
    }
    fun floats(values: FloatArray) = JsonArray(values.map { JsonPrimitive(it) })
    fun positions(values: Map<ParameterId, Float>): JsonArray {
        val pose = evaluator.evaluate(puppet, values)
        return JsonArray(puppet.drawables.map { d -> buildJsonObject {
            put("id", d.id.raw)
            put("xy", floats(pose.worldPositions[d.id] ?: defaults.worldPositions[d.id] ?: error("Hidden source mesh")))
            put("opacity", pose.opacity[d.id] ?: 0f)
            put("drawOrder", pose.drawOrder[d.id] ?: d.drawOrder)
        } })
    }
    val atlas = preview.atlas.pages.mapIndexed { i, page ->
        val filename = "atlas-$i.png"
        ImageIO.write(page.image, "png", out.parent.resolve(filename).toFile())
        filename
    }
    val x = puppet.parameters.find { it.id.raw == "ParamAngleX" }
    val y = puppet.parameters.find { it.id.raw == "ParamAngleY" }
    val report = buildJsonObject {
        put("generator", "Pinned psd2live CPU evaluator; native mesh/atlas, scalar keys and coupled head lattice")
        put("coordinateSystem", "world-y-up")
        put("canvas", buildJsonObject { put("width", preview.analysis.source.widthPx); put("height", preview.analysis.source.heightPx) })
        put("drawables", JsonArray(puppet.drawables.map { d -> buildJsonObject {
            val mesh = requireNotNull(d.mesh)
            val layerId = preview.rig.layerIdByDrawableId[d.id.raw] ?: ""
            put("id", d.id.raw); put("layer", layers[layerId]?.name ?: layerId)
            put("indices", JsonArray(mesh.indices.map { JsonPrimitive(it) }))
            put("uvs", floats(mesh.uvs))
            put("rest", floats(defaults.worldPositions[d.id] ?: error("Hidden source mesh ${d.id.raw}")))
            put("opacity", defaults.opacity[d.id] ?: 0f)
            put("drawOrder", defaults.drawOrder[d.id] ?: d.drawOrder)
            put("textureFile", atlas[preview.rig.pageByDrawableId[d.id.raw] ?: d.texturePage])
            put("maskedBy", JsonArray(d.maskedBy.map { JsonPrimitive(it.raw) }))
            put("invertMask", d.invertMask)
        } }))
        put("parameters", JsonArray(puppet.parameters.map { p -> buildJsonObject {
            put("id", p.id.raw); put("name", p.name)
            put("min", p.min); put("max", p.max); put("default", p.default)
            put("keypoints", JsonArray(keys(p.id).map { value -> buildJsonObject {
                put("value", value); put("positions", positions(mapOf(p.id to value)))
            } }))
        } }))
        if (x != null && y != null) put("headLattice", buildJsonObject {
            put("x", x.id.raw); put("y", y.id.raw)
            put("cells", JsonArray(keys(x.id).flatMap { xv -> keys(y.id).map { yv -> buildJsonObject {
                put("x", xv); put("y", yv); put("positions", positions(mapOf(x.id to xv, y.id to yv)))
            } } }))
        })
        put("limitations", "No physics simulation or Cubism Core; independently sampled non-head axes do not prove arbitrary simultaneous-expression parity.")
    }
    Files.writeString(out, Json { prettyPrint = false }.encodeToString(JsonObject.serializer(), report) + "\n")
    println("pose dump: $out, ${puppet.parameters.size} parameters, ${puppet.drawables.size} native meshes")
}
