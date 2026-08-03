extends SceneTree

## 三端一致性检查(R20-4):用同一个引擎包、同一种子把流程演到结束,
## 输出变量终值与检定记录,供与 TS / C# 运行库逐字比对。
##
##   godot --headless --path examples/godot-demo --script sample_run.gd
##
## 对照命令:
##   node scratch/ts-run.mjs examples/godot-demo/sample_package.json demo_rain_night 42
##   dotnet run --project examples/unity-demo/conformance -- --demo examples/godot-demo/sample_package.json demo_rain_night 42

func _initialize() -> void:
	var text := FileAccess.get_file_as_string("res://sample_package.json")
	var pkg = JSON.parse_string(text)
	if typeof(pkg) != TYPE_DICTIONARY:
		printerr("✗ 读不到 sample_package.json")
		quit(1)
		return

	var run = TheLoomRuntime.new(pkg, "demo_rain_night")
	run.seed_val = 42
	run.start()

	var guard := 0
	while not run.ended and run.choices.size() > 0 and guard < 200:
		guard += 1
		run.choose(0)

	var checks: Array = []
	for beat in run.log:
		if beat.get("kind", "") == "check":
			checks.append(beat.get("note", ""))

	# 变量按名字排序输出,避免字典顺序差异干扰比对
	var names = run.vars.keys()
	names.sort()
	var pairs: Array = []
	for name in names:
		pairs.append('"%s":%s' % [name, _json_value(run.vars[name])])

	print("{\"vars\":{%s},\"beats\":%d,\"checks\":%s}" % [
		",".join(pairs), run.log.size(), JSON.stringify(checks),
	])
	quit(0)


func _json_value(v) -> String:
	match typeof(v):
		TYPE_BOOL: return "true" if v else "false"
		TYPE_INT: return str(v)
		TYPE_FLOAT:
			var f: float = v
			return str(int(f)) if fposmod(f, 1.0) == 0.0 else str(f)
		_: return JSON.stringify(str(v))
