import { SignedIn, SignedOut, SignIn, UserButton } from '@clerk/clerk-react'
import type { ReactNode } from 'react'

type AuthGuardProps = {
  children: ReactNode
}

export function AuthGuard({ children }: AuthGuardProps) {
  return (
    <>
      <SignedOut>
        <div className="auth-container">
          <SignIn routing="hash" />
        </div>
      </SignedOut>
      <SignedIn>
        {children}
      </SignedIn>
    </>
  )
}

export function UserMenu() {
  return (
    <UserButton 
      afterSignOutUrl="/"
      appearance={{
        elements: {
          avatarBox: 'user-avatar',
        }
      }}
    />
  )
}
