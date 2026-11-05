// SPDX-License-Identifier: GPL-3.0-only
// Adapter compiled in the separately installed, pinned GPL psd2live process.
package io.github.psd2live.combinedexport

import kotlinx.serialization.json.*
import org.umamo.runtime.model.*
import org.umamo.interop.ExportNotice
import org.umamo.interop.moc3.Moc3Sidecars
import org.umamo.interop.cmo3.Cmo3Conversion
import org.umamo.format.cmo3.Cmo3
import java.nio.file.Files
import java.nio.file.Path
import javax.imageio.ImageIO

private fun JsonObject.str(k: String) = getValue(k).jsonPrimitive.content
private fun JsonObject.num(k: String) = getValue(k).jsonPrimitive.float
private fun JsonElement.floats() = jsonArray.map { it.jsonPrimitive.float }.toFloatArray()
private fun JsonElement.ints() = jsonArray.map { it.jsonPrimitive.int }.toIntArray()

private fun puppetFrom(j: JsonObject, target: RuntimeTarget): PuppetModel {
    val parameters = j.getValue("parameters").jsonArray.map { v -> val p = v.jsonObject
        Parameter(ParameterId(p.str("id")), p.str("name"), p.num("min"), p.num("max"), p.num("default"), if (p["kind"]?.jsonPrimitive?.content == "blend_shape") ParameterKind.BLEND_SHAPE else ParameterKind.NORMAL)
    }
    val drawables = j.getValue("drawables").jsonArray.map { v -> val d = v.jsonObject
        val axes = d.getValue("axes").jsonArray.map { a -> val x = a.jsonObject
            KeyformAxis(ParameterId(x.str("id")), x.getValue("keys").floats()) }
        val cells = d.getValue("cells").jsonArray.map { it.jsonObject }
        val geometry = if (axes.isEmpty()) null else KeyformGrid(axes, cells.map { c ->
            KeyformCell(c.getValue("coordinate").ints(), MeshDeltaForm(c.getValue("delta").floats())) })
        val opacity = if (axes.isEmpty()) ChannelGrids.Empty else ChannelGrids(mapOf(FormChannel.OPACITY to
            KeyformGrid<ChannelValue>(axes, cells.map { c -> KeyformCell(c.getValue("coordinate").ints(), ChannelValue.Scalar(c.num("opacity"))) })))
        val morphs = d["morphs"]?.jsonArray?.map { raw -> val m=raw.jsonObject
            val keys=m.getValue("keys").floats(); val neutral=m.getValue("neutral").jsonPrimitive.int
            BlendShapeBinding<MeshForm>(ParameterId(m.str("id")), keys, neutral,
                m.getValue("forms").jsonArray.mapIndexed { i,f -> if (i==neutral) null else MeshForm(f.floats(), d.num("order"), m["opacities"]?.jsonArray?.get(i)?.jsonPrimitive?.float ?: d.num("neutralOpacity")) },
                limits=m["limits"]?.jsonArray?.map { item -> val limit=item.jsonObject
                    BlendWeightLimit(ParameterId(limit.str("id")),limit.getValue("keys").jsonArray.mapIndexed { index,key -> BlendWeightLimitPoint(key.jsonPrimitive.float,limit.getValue("weights").jsonArray[index].jsonPrimitive.float) })
                } ?: emptyList())
        } ?: emptyList()
        Drawable(id=DrawableId(d.str("id")), name=d.str("name"), parentDeformerId=null,
            blendMode=BlendMode.Normal, maskedBy=d.getValue("masks").jsonArray.map { DrawableId(it.jsonPrimitive.content) },
            mesh=DrawableMesh(d.getValue("positions").floats(), d.getValue("uvs").floats(), d.getValue("indices").ints()),
            geometryGrid=geometry, channelGrids=opacity, blendShapes=morphs, drawOrder=d.num("order"), opacity=d.num("opacity"),
            isVisible=d.getValue("enabled").jsonPrimitive.boolean, texturePage=d.getValue("texture").jsonPrimitive.int)
    }
    val width=j.num("width"); val height=j.num("height")
    return PuppetModel(parameters=parameters,parts=emptyList(),deformers=emptyList(),drawables=drawables,
        rootChildren=drawables.reversed().map { OrgChild.Drawable(it.id) },rootPartId=null,
        canvasWidth=width,canvasHeight=height,worldOriginX=width/2,worldOriginY=-height/2,
        pixelsPerUnit=width/2,runtimeTarget=target,
        parameterLinks=j.getValue("links").jsonArray.map { p -> ParameterLink(ParameterId(p.jsonArray[0].jsonPrimitive.content),ParameterId(p.jsonArray[1].jsonPrimitive.content)) }).withDerivedRenderRoot()
}

fun main(args: Array<String>) {
    val input = Path.of(args[0]); val out = Path.of(args[1])
    val j = Json.parseToJsonElement(Files.readString(input)).jsonObject
    val targetVersion = j["runtimeTarget"]?.jsonPrimitive?.int ?: 42
    val target = when(targetVersion) {
        42 -> RuntimeTarget.Cubism42
        50 -> RuntimeTarget.Cubism50
        else -> error("Unsupported Cubism runtime target: $targetVersion")
    }
    val puppet=puppetFrom(j,target)
    val editorPuppet=j["editor"]?.jsonObject?.let { puppetFrom(it,target) } ?: puppet
    val parameters=puppet.parameters
    val drawables=puppet.drawables
    val names=j.getValue("textures").jsonArray.map { it.jsonPrimitive.content }
    val bytes=names.map { Files.readAllBytes(input.parent.resolve(it)) }
    val bundle=Moc3Sidecars.bundle(puppet,j.str("name"),pages=names.mapIndexed { i,n -> Moc3Sidecars.AtlasPage(n,bytes[i]) })
    require(bundle.report.isEmpty) { "Lossy runtime export refused: ${bundle.report.notices}" }
    Files.createDirectories(out)
    for (file in bundle.files) { val path=out.resolve(file.name);Files.createDirectories(path.parent);Files.write(path,file.bytes) }
    val cmo=Cmo3Conversion.freshCmo3(editorPuppet,bytes.map { b -> val image=ImageIO.read(b.inputStream());Cmo3Conversion.AtlasPage(b,image.width,image.height) },
        editorPuppet.drawables.associate { it.id.raw to it.texturePage },j.str("name"),0L,targetVersion)
    require(cmo.report.notices.all { it is ExportNotice.MissingSourceArt }) { "Lossy editor export refused: ${cmo.report.notices}" }
    Files.write(out.resolve(j.str("name")+".cmo3"),Cmo3.write(cmo.model))
    Files.writeString(out.resolve("export-notices.txt"),"MOC3: no export notices\nCMO3: ${cmo.report.notices}\n")
    println("Exported ${drawables.size} meshes and ${parameters.size} controls to $out")
}
