import * as React from "react"

const MOBILE_BREAKPOINT = 768

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(undefined)

  React.useEffect(() => {
    const checkDevice = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT)
    }
    
    // Check on mount
    checkDevice()

    window.addEventListener("resize", checkDevice)
    
    // Cleanup
    return () => window.removeEventListener("resize", checkDevice)
  }, [])

  return isMobile
}
