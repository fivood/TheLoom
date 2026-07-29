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
	quit(0)
