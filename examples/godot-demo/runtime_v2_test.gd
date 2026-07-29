extends SceneTree

const Runtime = preload("res://theloom_runtime.gd")

func _initialize() -> void:
	var text := FileAccess.get_file_as_string("res://runtime_v2_fixture.json")
	var pkg = JSON.parse_string(text)
	assert(typeof(pkg) == TYPE_DICTIONARY)
	var run = Runtime.new(pkg, "protocol_test")
	run.start()
	assert(run.protocol_version == 2)
	assert(run.source_protocol_version == 2)
	assert(run.events.size() == 6)
	assert(run.events.map(func(event): return "%s:%s" % [event["nodeId"], event["event"]]) == [
		"set:enter", "set:display", "set:leave",
		"say:enter", "say:display", "say:leave",
	])
	var set_display: Dictionary = run.events[1]
	assert(set_display["assetIds"] == ["voice"])
	assert(set_display["fields"][0]["value"] == "低声")
	assert(set_display["changes"]["variables"][0] == { "name": "n", "before": 0, "after": 1 })
	assert(set_display["changes"]["entities"][0] == {
		"entityTechnicalName": "detective",
		"field": "trust",
		"before": 5,
		"after": 7,
	})
	var say_enter: Dictionary = run.events[3]
	assert(say_enter["edgeId"] == "next")
	assert(say_enter["choiceKey"] == "choice-next")
	assert(say_enter["changes"]["variables"][0] == { "name": "n", "before": 1, "after": 3 })

	# ---------- R19-2 跨流程调用:与 TypeScript 运行库同一夹具、同一断言 ----------
	var fails: Array = []
	var check := func(name: String, got, want) -> void:
		if got != want:
			fails.append("%s: got=%s want=%s" % [name, str(got), str(want)])

	var x = Runtime.new(pkg, "caller")
	x.start()
	check.call("flow=callee", x.flow["id"], "callee")
	check.call("callStack=1", x.call_stack.size(), 1)
	var texts: Array = x.log.map(func(b): return b["text"])
	check.call("不走默认起点", texts.has("默认起点(不该走到)"), false)
	check.call("走命名入口", texts.has("支线开场"), true)
	check.call("文本参数字面量", x.vars.get("who"), "林晚")
	check.call("数值参数表达式", x.vars.get("bonus"), 5)

	x.choose(0)
	check.call("返回值写回", x.vars.get("result"), 15)
	check.call("回到调用方", x.flow["id"], "caller")
	check.call("调用栈清空", x.call_stack.size(), 0)
	check.call("参数还原原值", x.vars.get("who"), "原值")
	check.call("临时参数删除", x.vars.has("bonus"), false)
	var last_beat: Dictionary = x.log[x.log.size() - 1]
	check.call("继续走调用点出边", last_beat["text"], "回来了")

	if fails.is_empty():
		print("R19-2 Godot 跨流程调用:全部断言通过")
		quit(0)
	else:
		for f in fails:
			printerr("FAIL ", f)
		printerr("实际 log: ", texts)
		quit(1)
