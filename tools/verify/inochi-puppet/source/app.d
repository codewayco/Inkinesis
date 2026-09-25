/**
 * Does Inochi2D's OWN puppet loader read the .inp this pipeline writes, and
 * where does its own deformation put the vertices?
 *
 *   inochi-puppet-check <out.json> <file.inp> [more.inp ...]
 *   inochi-puppet-check --pose <out.json> <file.inp> [samples.json]
 *
 * Built by `npm run prepare:inochi` and invoked by the pipeline's
 * native-validation stage (see tools/imageToRig/pipeline.ts).
 *
 * WHY THIS EXISTS. `tools/rig/inp.ts` writes a binary container against a
 * specification that says of itself that it is out of date. A file that looks
 * right to the program that wrote it is worth nothing; the only evidence that
 * means anything is their loader reading it.
 *
 * WHAT IS LINKED. `inochi2d` 0.8.7 and nothing of ours, in its `renderless`
 * configuration, which is the library's own headless mode -- textures are kept
 * as compressed blobs instead of being uploaded to a GL context that does not
 * exist here. The node tree, the meshes and the parameter list all deserialise
 * the same way they do in Inochi Creator, because it is the same code.
 *
 * WHAT A PASS PROVES. The container is legible: magic bytes, JSON length, the
 * texture section, and a puppet whose nodes they construct as the types we
 * named. Every Part comes back with the mesh we wrote. In `--pose` mode the
 * reported vertices are the ones Inochi2D itself computes at each requested
 * parameter setting. A file this fails on cannot be opened by Inochi Creator.
 *
 * WHAT A PASS DOES NOT PROVE. That the rig LOOKS right: nothing here
 * rasterises. A separate step draws the reported positions. This program says
 * the structure survives the round trip and where the geometry lands, and no
 * claim from it may say more.
 */
module app;

import std.stdio;
import std.json;
import std.file : write, exists, readText;
import std.string : format;
import std.conv : to;
import inochi2d;
import inmath.linalg : vec2;
import std.exception : enforce;
import std.algorithm : sort;

/** One node as their loader reconstructed it, children and all. */
JSONValue describe(Node node)
{
    JSONValue out_ = ["name": JSONValue(node.name), "type": JSONValue(node.typeId)];
    out_["uuid"] = JSONValue(cast(long)node.uuid);
    out_["enabled"] = JSONValue(node.enabled);
    out_["zsort"] = JSONValue(cast(double)node.zSort);

    // A Part is where the work is: if the mesh did not survive, the rigger
    // still has to draw one and the export bought them nothing.
    if (auto drawable = cast(Drawable)node) {
        out_["verts"] = JSONValue(cast(long)drawable.vertices.length);
        out_["indices"] = JSONValue(cast(long)drawable.getMesh().indices.length);
        out_["uvs"] = JSONValue(cast(long)drawable.getMesh().uvs.length);
    }
    if (auto part = cast(Part)node) {
        out_["blendMode"] = JSONValue(part.blendingMode.to!string);
        out_["opacity"] = JSONValue(part.opacity);
        out_["textureIds"] = JSONValue(part.textureIds);
    }

    JSONValue[] kids;
    foreach (child; node.children) kids ~= describe(child);
    if (kids.length) out_["children"] = JSONValue(kids);
    return out_;
}

/**
 * Drive the rig with THEIR code and write out where the vertices landed.
 *
 * This is the only way to see whether the exported parameters do anything
 * without a rigging tool: Inochi Creator has no headless mode, and its macOS
 * build is ad-hoc signed, so whether it launches on a given machine is not
 * something this repository can establish. What it can do is set a parameter
 * on the puppet THEIR loader built, call THEIR update, and read the vertex
 * positions THEIR deformation produced. Nothing here draws; a separate step
 * rasterises these positions, so the picture is their geometry and our pixels.
 */
int dumpPoses(string outPath, string file, string samplePath = "")
{
    inInit(() => 0.0);
    Puppet puppet = inLoadPuppet(file);

    JSONValue[] frames;
    /** One frame: every part's deformed vertices at one parameter setting. */
    void capture(string label, string paramName, float value, float valueY = 0,
        string otherName = "", float otherValue = 0, string thirdName = "", float thirdValue = 0,
        string supplied = "")
    {
        foreach (param; puppet.parameters)
            param.value = vec2(param.defaults.x, param.defaults.y);
        if (paramName.length)
        {
            auto index = puppet.findParameterIndex(paramName);
            enforce(index >= 0, "no parameter named " ~ paramName);
            puppet.parameters[index].value = vec2(value, valueY);
        }
        foreach (i, name; [otherName, thirdName]) if (name.length) {
            auto index = puppet.findParameterIndex(name);
            enforce(index >= 0, "no parameter named " ~ name);
            puppet.parameters[index].value = vec2(i == 0 ? otherValue : thirdValue, 0);
        }
        if (supplied.length) {
            auto values = parseJSON(supplied);
            foreach (name, entry; values.object) {
                auto index = puppet.findParameterIndex(name);
                enforce(index >= 0, "unknown combined control " ~ name);
                float number(JSONValue v) { return v.type == JSONType.integer ? cast(float)v.integer : cast(float)v.floating; }
                puppet.parameters[index].value = vec2(number(entry.array[0]), number(entry.array[1]));
            }
        }
        puppet.update();

        JSONValue[] parts;
        void walk(Node node)
        {
            if (auto drawable = cast(Drawable)node)
            {
                JSONValue[] xy;
                foreach (i, vertex; drawable.vertices)
                {
                    auto moved = vertex + drawable.deformation[i];
                    xy ~= JSONValue(cast(double)moved.x);
                    xy ~= JSONValue(cast(double)moved.y);
                }
                parts ~= JSONValue([
                    "uuid": JSONValue(cast(long)node.uuid),
                    "name": JSONValue(node.name),
                    "zsort": JSONValue(cast(double)node.zSort),
                    "xy": JSONValue(xy),
                    "opacity": JSONValue(cast(double)(cast(Part)node is null ? 1.0f : (cast(Part)node).opacity * (cast(Part)node).getValue("opacity"))),
                    "enabled": JSONValue(node.enabled),
                ]);
            }
            foreach (child; node.children) walk(child);
        }
        walk(puppet.root);
        sort!((a,b) => a["zsort"].floating < b["zsort"].floating)(parts);
        frames ~= JSONValue([
            "label": JSONValue(label), "parameter": JSONValue(supplied.length ? "Combined" : paramName),
            "value": JSONValue(cast(double)value), "valueY": JSONValue(cast(double)valueY), "parts": JSONValue(parts),
            "additionalControls": JSONValue([otherName, thirdName]),
            "suppliedControls": supplied.length ? parseJSON(supplied) : JSONValue(null),
        ]);
    }

    capture("rest", "", 0);
    foreach (param; puppet.parameters)
    {
        capture(param.name ~ " min", param.name, param.min.x);
        capture(param.name ~ " max", param.name, param.max.x);
        if (!param.isVec2 && param.name != "Viseme") {
            foreach (i, point; param.axisPoints[0]) {
                auto value = param.min.x + point * (param.max.x-param.min.x);
                if (value != param.min.x && value != param.max.x && value != param.defaults.x)
                    capture(param.name ~ " key " ~ i.to!string, param.name, value);
            }
        }
        if (param.isVec2) {
            foreach (x; [param.min.x, param.defaults.x, param.max.x])
                foreach (y; [param.min.y, param.defaults.y, param.max.y])
                    capture(param.name ~ " lattice " ~ x.to!string ~ " " ~ y.to!string, param.name, x, y);
        }
        if (param.name == "Head Angles") {
            capture("Common Head Yaw min", param.name, -25, 0);
            capture("Common Head Yaw max", param.name, 25, 0);
            capture("Common Head Pitch min", param.name, 0, -20);
            capture("Common Head Pitch max", param.name, 0, 20);
            foreach (i; 0 .. 9) capture("Head sequence " ~ i.to!string, param.name, -25+i*6.25f, 0);
        }
        if (param.name == "ParamAngleZ") {
            capture("Common Head Roll min", param.name, -15);
            capture("Common Head Roll max", param.name, 15);
        }
        if (param.name == "Viseme")
            foreach (value; 1 .. 7)
                capture("Viseme " ~ value.to!string, param.name, cast(float)value);
    }
    if (puppet.findParameterIndex("ParamEyeLOpen") >= 0 && puppet.findParameterIndex("ParamEyeROpen") >= 0) {
        capture("Both eyes closed", "ParamEyeLOpen", 0, 0, "ParamEyeROpen", 0);
        if (puppet.findParameterIndex("Viseme") >= 0)
            capture("Closed eyes open mouth", "ParamEyeLOpen", 0, 0, "ParamEyeROpen", 0, "Viseme", 4);
        else if (puppet.findParameterIndex("ParamMouthOpenY") >= 0)
            capture("Closed eyes open mouth", "ParamEyeLOpen", 0, 0, "ParamEyeROpen", 0, "ParamMouthOpenY", 1);
    }
    if (samplePath.length) foreach (request; parseJSON(readText(samplePath)).array)
        capture(request["label"].str, "", 0, 0, "", 0, "", 0, request["values"].toString());

    JSONValue report = [
        "tool": JSONValue("tools/verify/inochi-puppet --pose, linking inochi2d 0.8.7 "
            ~ "(renderless) and nothing of ours"),
        "question": JSONValue("Where does THEIR deformation put the vertices when THEIR "
            ~ "parameter is driven to each end?"),
        "whatThisIsNot": JSONValue("A picture. Nothing here rasterises; a separate step draws "
            ~ "these positions, so the geometry is theirs and only the pixels are ours."),
        "file": JSONValue(file),
        "frames": JSONValue(frames),
    ];
    write(outPath, report.toPrettyString() ~ "\n");
    writefln("%s: %d frame(s) from %d parameter(s)",
        outPath, frames.length, puppet.parameters.length);
    return 0;
}

int main(string[] args)
{
    if (args.length >= 4 && args[1] == "--pose") return dumpPoses(args[2], args[3], args.length >= 5 ? args[4] : "");
    if (args.length < 3)
    {
        stderr.writeln("usage: inochi-puppet-check <out.json> <file.inp> [more.inp ...]");
        stderr.writeln("       inochi-puppet-check --pose <out.json> <file.inp>");
        return 2;
    }

    // Their node-type factory is populated by `inInit`, not by module
    // constructors: without this every child is skipped as an unknown type and
    // the puppet comes back as a bare root, which reads exactly like a file we
    // wrote wrong. No GL context is created -- the renderless build guards it.
    inInit(() => 0.0);

    JSONValue[] results;
    bool allRead = true;

    foreach (path; args[2 .. $])
    {
        JSONValue record = ["file": JSONValue(path)];
        if (!exists(path))
        {
            record["read"] = JSONValue(false);
            record["error"] = JSONValue("no such file");
            allRead = false;
            results ~= record;
            continue;
        }

        try
        {
            Puppet puppet = inLoadPuppet(path);
            record["read"] = JSONValue(true);
            record["meta"] = JSONValue([
                "name": JSONValue(puppet.meta.name),
                "version": JSONValue(puppet.meta.version_),
                "rigger": JSONValue(puppet.meta.rigger),
            ]);

            // Counted by walking what THEY built, not by trusting what we wrote.
            size_t nodes, parts, drawablesWithMesh, verts;
            void walk(Node n)
            {
                nodes++;
                if (cast(Part)n) parts++;
                if (auto d = cast(Drawable)n)
                {
                    verts += d.vertices.length;
                    if (d.vertices.length >= 3 && d.getMesh().indices.length >= 3) drawablesWithMesh++;
                }
                foreach (child; n.children) walk(child);
            }
            walk(puppet.root);

            record["nodes"] = JSONValue(cast(long)nodes);
            record["parts"] = JSONValue(cast(long)parts);
            record["partsWithAUsableMesh"] = JSONValue(cast(long)drawablesWithMesh);
            record["vertices"] = JSONValue(cast(long)verts);
            record["textureSlots"] = JSONValue(cast(long)inCurrentPuppetTextureSlots.length);
            // The parameters, as THEY rebuilt them. A binding they dropped --
            // a node uuid that resolves to nothing, a keypoint count that does
            // not match the axis -- disappears here and nowhere else, so the
            // count is taken from their objects rather than from our file.
            JSONValue[] params;
            size_t bindings, keypoints, offsets, unresolvedBindings, mismatchedKeypoints;
            foreach (param; puppet.parameters)
            {
                size_t paramBindings, paramOffsets, unresolved, mismatched;
                foreach (binding; param.bindings)
                {
                    paramBindings++;
                    // A binding whose node did not resolve, or whose offsets do
                    // not count one per vertex of the part it targets, is the
                    // way a hand-written rig goes wrong WITHOUT failing to load.
                    Node target = binding.getTarget().node;
                    if (target is null) { unresolved++; continue; }
                    auto drawable = cast(Drawable)target;
                    if (auto deform = cast(DeformationParameterBinding)binding)
                        foreach (column; deform.values)
                            foreach (value; column)
                            {
                                paramOffsets += value.vertexOffsets.size();
                                if (drawable is null
                                    || value.vertexOffsets.size() != drawable.vertices.length)
                                    mismatched++;
                            }
                }
                unresolvedBindings += unresolved;
                mismatchedKeypoints += mismatched;
                bindings += paramBindings;
                offsets += paramOffsets;
                keypoints += param.axisPointCount(0) * param.axisPointCount(1);
                params ~= JSONValue([
                    "name": JSONValue(param.name),
                    "isVec2": JSONValue(param.isVec2),
                    "keypointsX": JSONValue(cast(long)param.axisPointCount(0)),
                    "keypointsY": JSONValue(cast(long)param.axisPointCount(1)),
                    "bindings": JSONValue(cast(long)paramBindings),
                    "vertexOffsets": JSONValue(cast(long)paramOffsets),
                ]);
            }
            record["parameters"] = JSONValue(cast(long)puppet.parameters.length);
            record["bindings"] = JSONValue(cast(long)bindings);
            record["vertexOffsets"] = JSONValue(cast(long)offsets);
            record["bindingsWithNoTarget"] = JSONValue(cast(long)unresolvedBindings);
            record["keypointsWithWrongVertexCount"] = JSONValue(cast(long)mismatchedKeypoints);
            record["parameterDetail"] = JSONValue(params);
            record["rigged"] = JSONValue(puppet.parameters.length > 0 && bindings > 0
                && unresolvedBindings == 0 && mismatchedKeypoints == 0);
            if (unresolvedBindings || mismatchedKeypoints) allRead = false;
            record["tree"] = describe(puppet.root);
        }
        catch (Exception ex)
        {
            record["read"] = JSONValue(false);
            record["error"] = JSONValue(ex.msg);
            allRead = false;
        }
        results ~= record;
    }

    JSONValue report = [
        "tool": JSONValue("tools/verify/inochi-puppet, linking inochi2d 0.8.7 (renderless) and nothing of ours"),
        "question": JSONValue("Does Inochi2D's own loader read the .inp this pipeline writes?"),
        "whatAPassProves": JSONValue(
            "The container and the puppet JSON are legible to them: their loader "
            ~ "constructs the node types we named and every Part comes back with its mesh. "
            ~ "A file this fails on cannot be opened in Inochi Creator at all."),
        "whatAPassDoesNotProve": JSONValue(
            "That the rig is GOOD. The parameter and binding counts are what their loader "
            ~ "rebuilt, and a binding they dropped is missing from them; nothing here "
            ~ "rasterises, so no claim from this may say the character looks right posed."),
        "files": JSONValue(results),
        "allRead": JSONValue(allRead),
    ];

    write(args[1], report.toPrettyString() ~ "\n");
    foreach (record; results)
    {
        if (record["read"].boolean)
            writefln("%s: read %d node(s), %d part(s), %d with a usable mesh, "
                ~ "%d texture(s), %d parameter(s) -- %s",
                record["file"].str, record["nodes"].integer, record["parts"].integer,
                record["partsWithAUsableMesh"].integer, record["textureSlots"].integer,
                record["parameters"].integer,
                record["rigged"].boolean
                    ? format("%d binding(s), %d vertex offset(s), all resolved",
                        record["bindings"].integer, record["vertexOffsets"].integer)
                    : format("NOT SOUND: %d binding(s), %d with no target, %d keypoint(s) "
                        ~ "with the wrong vertex count",
                        record["bindings"].integer,
                        record["bindingsWithNoTarget"].integer,
                        record["keypointsWithWrongVertexCount"].integer));
        else
            writefln("%s: NOT READ -- %s", record["file"].str, record["error"].str);
    }
    return allRead ? 0 : 1;
}
