# React Native Mobile App Plan

This document outlines the plan for building a React Native mobile app that shares the same API as the existing web app.

---

## Overview

**Goal:** Create a native mobile app (iOS/Android) that provides the same chat functionality as the web app, consuming the existing Express API.

**Approach:**
- Add a new `apps/mobile` workspace to the monorepo
- Extract shared types into `packages/shared`
- Port the API client from the web app
- Build native UI components using React Native

---

## Project Structure

### New directories to create:

```
pro-chat/
├── apps/
│   ├── api/                    # Existing - no changes
│   ├── web/                    # Existing - minor changes (import from shared)
│   └── mobile/                 # NEW - React Native app
│       ├── package.json
│       ├── app.json
│       ├── tsconfig.json
│       ├── babel.config.js
│       ├── metro.config.js
│       ├── index.js
│       ├── App.tsx
│       └── src/
│           ├── screens/
│           │   ├── ThreadListScreen.tsx
│           │   ├── ChatScreen.tsx
│           │   └── SettingsScreen.tsx
│           ├── components/
│           │   ├── MessageBubble.tsx
│           │   ├── MessageInput.tsx
│           │   ├── ThreadItem.tsx
│           │   ├── ModelSelector.tsx
│           │   └── AttachmentPicker.tsx
│           ├── services/
│           │   └── api.ts       # Ported from web
│           ├── hooks/
│           │   ├── useThreads.ts
│           │   ├── useMessages.ts
│           │   └── useStreaming.ts
│           ├── navigation/
│           │   └── AppNavigator.tsx
│           ├── theme/
│           │   └── index.ts
│           └── utils/
│               └── storage.ts
│
└── packages/
    └── shared/                  # NEW - Shared types
        ├── package.json
        ├── tsconfig.json
        └── src/
            ├── index.ts
            └── types.ts         # Extracted from web/src/types.ts
```

---

## Phase 1: Setup Shared Package

### 1.1 Create packages/shared

**packages/shared/package.json:**
```json
{
  "name": "@pro-chat/shared",
  "version": "0.0.1",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch"
  },
  "devDependencies": {
    "typescript": "^5.4.0"
  }
}
```

**packages/shared/tsconfig.json:**
```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "declaration": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true
  },
  "include": ["src/**/*"]
}
```

### 1.2 Extract types from web app

Move these types from `apps/desktop/src/types.ts` to `packages/shared/src/types.ts`:

- `Thread`
- `Message`
- `Attachment`
- `Model`
- `Settings`
- `StreamCallbacks` (or similar streaming event types)

### 1.3 Update web app imports

Change imports in `apps/desktop/src/` from:
```typescript
import { Thread, Message } from './types'
```
To:
```typescript
import { Thread, Message } from '@pro-chat/shared'
```

---

## Phase 2: Initialize React Native App

### 2.1 Create the app

Using React Native CLI (recommended for monorepo flexibility):

```bash
cd apps
npx react-native init mobile --template react-native-template-typescript
```

Or using Expo (easier setup, some limitations):

```bash
cd apps
npx create-expo-app mobile --template blank-typescript
```

### 2.2 Configure for monorepo

**apps/mobile/metro.config.js** (for React Native CLI):
```javascript
const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '../..');

const config = {
  watchFolders: [workspaceRoot],
  resolver: {
    nodeModulesPaths: [
      path.resolve(projectRoot, 'node_modules'),
      path.resolve(workspaceRoot, 'node_modules'),
    ],
    extraNodeModules: {
      '@pro-chat/shared': path.resolve(workspaceRoot, 'packages/shared'),
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(projectRoot), config);
```

### 2.3 Add dependencies

```bash
cd apps/mobile
npm install @react-navigation/native @react-navigation/native-stack
npm install react-native-screens react-native-safe-area-context
npm install react-native-gesture-handler
npm install @react-native-async-storage/async-storage
npm install react-native-image-picker        # For attachments
npm install react-native-document-picker     # For file attachments
npm install react-native-markdown-display    # For rendering responses
```

### 2.4 Update root package.json

Add the new workspaces:
```json
{
  "workspaces": [
    "apps/*",
    "packages/*"
  ]
}
```

---

## Phase 3: Port API Client

### 3.1 Create apps/mobile/src/services/api.ts

Port the API client from `apps/desktop/src/api.ts` with these modifications:

1. **Base URL configuration:**
```typescript
// apps/mobile/src/services/api.ts
import { Thread, Message, Model, Settings } from '@pro-chat/shared';

// In development, use your machine's IP or ngrok URL
// In production, use your deployed API URL
const API_BASE_URL = __DEV__
  ? 'http://192.168.1.100:8787'  // Your local machine IP
  : 'https://your-production-api.com';

async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}
```

2. **Streaming implementation:**

React Native supports `fetch` with streaming, but the implementation differs slightly:

```typescript
export async function streamChat(
  params: {
    threadId: string;
    content: string;
    model: string;
    thinkingLevel?: string;
    attachments?: string[];
  },
  callbacks: {
    onMeta?: (meta: any) => void;
    onDelta?: (delta: string) => void;
    onTool?: (tool: any) => void;
    onReasoning?: (reasoning: string) => void;
    onDone?: (message: Message) => void;
    onError?: (error: Error) => void;
  }
): Promise<void> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/chat/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const reader = response.body?.getReader();
    if (!reader) throw new Error('No reader available');

    const decoder = new TextDecoder();
    let buffer = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          const eventType = line.slice(7);
          // Handle event type
        } else if (line.startsWith('data: ')) {
          const data = JSON.parse(line.slice(6));
          // Route to appropriate callback based on event type
        }
      }
    }
  } catch (error) {
    callbacks.onError?.(error as Error);
  }
}
```

3. **File upload handling:**

```typescript
export async function uploadFile(uri: string, filename: string, mimeType: string): Promise<Attachment> {
  const formData = new FormData();
  formData.append('file', {
    uri,
    name: filename,
    type: mimeType,
  } as any);

  const response = await fetch(`${API_BASE_URL}/api/uploads`, {
    method: 'POST',
    body: formData,
    headers: {
      'Content-Type': 'multipart/form-data',
    },
  });

  return response.json();
}
```

---

## Phase 4: Build Navigation

### 4.1 Create AppNavigator

**apps/mobile/src/navigation/AppNavigator.tsx:**
```typescript
import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import ThreadListScreen from '../screens/ThreadListScreen';
import ChatScreen from '../screens/ChatScreen';
import SettingsScreen from '../screens/SettingsScreen';

export type RootStackParamList = {
  ThreadList: undefined;
  Chat: { threadId: string; title?: string };
  Settings: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

export default function AppNavigator() {
  return (
    <NavigationContainer>
      <Stack.Navigator initialRouteName="ThreadList">
        <Stack.Screen
          name="ThreadList"
          component={ThreadListScreen}
          options={{ title: 'Chats' }}
        />
        <Stack.Screen
          name="Chat"
          component={ChatScreen}
          options={({ route }) => ({
            title: route.params.title || 'Chat'
          })}
        />
        <Stack.Screen
          name="Settings"
          component={SettingsScreen}
          options={{ title: 'Settings' }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
```

---

## Phase 5: Build Screens

### 5.1 ThreadListScreen

Displays all chat threads, allows creating new ones.

**Key features:**
- FlatList of threads
- Pull-to-refresh
- Swipe-to-delete
- FAB for new thread
- Navigate to ChatScreen on tap

### 5.2 ChatScreen

The main chat interface.

**Key features:**
- FlatList of messages (inverted for chat UX)
- Message input with send button
- Streaming response display
- Model selector dropdown
- Attachment button (camera/gallery/files)
- Thinking level toggle
- Auto-scroll to bottom on new messages

### 5.3 SettingsScreen

App and user settings.

**Key features:**
- System prompt editor
- Theme toggle (light/dark)
- API URL configuration (for development)
- Memory viewer/editor
- Clear cache option

---

## Phase 6: Build Components

### 6.1 MessageBubble

Renders a single message with:
- Different styles for user vs assistant
- Markdown rendering for assistant messages
- Attachment previews (images, file icons)
- Expandable thinking/reasoning trace
- Tool call display
- Copy message action

### 6.2 MessageInput

Text input area with:
- Multi-line TextInput
- Send button (disabled while streaming)
- Attachment button
- Character/token count (optional)

### 6.3 ModelSelector

Dropdown/modal for selecting the LLM model:
- List of available models from API
- Show model capabilities (vision, thinking)
- Persist last selection

### 6.4 AttachmentPicker

Modal for adding attachments:
- Take photo (camera)
- Choose from gallery
- Pick document
- Preview before attaching
- Remove attachment

---

## Phase 7: Testing Strategy

### 7.1 Testing without deploying API

**Option A: Local API with ngrok**
```bash
# Terminal 1: Run API locally
cd apps/api
npm run dev

# Terminal 2: Expose to internet
ngrok http 8787

# Use the ngrok URL in mobile app
# https://abc123.ngrok.io
```

**Option B: Local API with InMemoryRepo (no database)**
```typescript
// Modify apps/api/src/repository/index.ts temporarily
import { InMemoryRepo } from './InMemoryRepo';
export const repository = new InMemoryRepo();
```

**Option C: Mock API with MSW**
```bash
cd apps/mobile
npm install msw --save-dev
```

Create mock handlers that return test data without any backend.

### 7.2 Unit testing

```bash
npm install --save-dev jest @testing-library/react-native
```

Test components in isolation with mocked API responses.

### 7.3 E2E testing

**Detox** (recommended for React Native):
```bash
npm install --save-dev detox
```

**Maestro** (simpler setup):
```bash
brew install maestro
```

### 7.4 Testing on device

**iOS Simulator:**
```bash
cd apps/mobile
npx react-native run-ios
```

**Android Emulator:**
```bash
cd apps/mobile
npx react-native run-android
```

**Physical device with Expo Go** (if using Expo):
```bash
cd apps/mobile
npx expo start
# Scan QR code with Expo Go app
```

---

## Phase 8: Platform-Specific Considerations

### 8.1 iOS

- Request camera/photo library permissions in `Info.plist`
- Handle safe area insets (notch, home indicator)
- Support keyboard avoidance
- Consider haptic feedback for interactions

### 8.2 Android

- Request permissions at runtime (camera, storage)
- Handle back button navigation
- Support different screen sizes/densities
- Consider material design patterns

### 8.3 Both platforms

- Handle offline state gracefully
- Implement pull-to-refresh
- Support dark mode
- Handle app backgrounding during streaming

---

## Development Workflow

### Daily development

```bash
# Terminal 1: Run API
npm run dev --workspace=apps/api

# Terminal 2: Run Metro bundler
cd apps/mobile && npx react-native start

# Terminal 3: Run on simulator
cd apps/mobile && npx react-native run-ios
# or
cd apps/mobile && npx react-native run-android
```

### Testing on physical device

```bash
# Get your machine's local IP
ifconfig | grep "inet " | grep -v 127.0.0.1

# Update API_BASE_URL in api.ts to use this IP
# Example: http://192.168.1.100:8787

# For iOS physical device, use the same network
# For Android, you may need to run:
adb reverse tcp:8787 tcp:8787
```

---

## Milestones

### MVP (Minimum Viable Product)
- [ ] View list of threads
- [ ] Create new thread
- [ ] Send messages
- [ ] Receive streaming responses
- [ ] View message history
- [ ] Basic markdown rendering

### V1.0
- [ ] All MVP features
- [ ] Model selection
- [ ] Image attachments
- [ ] Dark/light theme
- [ ] Thinking level toggle
- [ ] Pull-to-refresh
- [ ] Swipe-to-delete threads

### V1.1+
- [ ] File attachments (PDF, etc.)
- [ ] Tool call visualization
- [ ] Reasoning trace expansion
- [ ] Settings screen
- [ ] System prompt editing
- [ ] Memory viewing
- [ ] Offline message queue
- [ ] Push notifications (requires backend changes)

---

## Estimated Effort

| Phase | Description | Complexity |
|-------|-------------|------------|
| 1 | Setup shared package | Low |
| 2 | Initialize React Native app | Low |
| 3 | Port API client | Medium |
| 4 | Build navigation | Low |
| 5 | Build screens | High |
| 6 | Build components | High |
| 7 | Testing setup | Medium |
| 8 | Platform polish | Medium |

---

## Open Questions

1. **Expo vs React Native CLI?**
   - Expo: Faster setup, easier testing, some native limitations
   - RN CLI: Full native access, more complex setup

2. **State management for mobile?**
   - Continue with hooks-only approach (like web)?
   - Add Zustand for better state isolation?

3. **Offline support priority?**
   - Queue messages when offline?
   - Cache threads/messages locally?

4. **Authentication?**
   - Current API has no auth (single user)
   - Mobile deployment may need auth before release

5. **Push notifications?**
   - Would require backend changes (store device tokens, send notifications)
   - Defer to post-MVP?
