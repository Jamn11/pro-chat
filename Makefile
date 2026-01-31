.PHONY: app dev

APP_PATH := apps/desktop/src-tauri/target/release/bundle/macos/pro-chat.app

app:
	npm run tauri:build -w apps/desktop
	@if [ -d "$(APP_PATH)" ]; then \
		open "$(APP_PATH)"; \
	else \
		echo "App not found at $(APP_PATH). Build may have failed."; \
		exit 1; \
	fi

dev:
	npm run tauri:dev -w apps/desktop
