'use client'

import 'react-phone-number-input/style.css'
import PhoneInputWithCountry, {
  type Country,
} from 'react-phone-number-input/react-hook-form'
import { useFormContext } from 'react-hook-form'
import { Input } from '@/components/ui/input'
import { Label } from './label'

interface PhoneInputProps {
  name: string
  label?: string
  placeholder?: string
  defaultCountry?: Country
}

const PhoneInput = ({
  name,
  label,
  ...props
}: PhoneInputProps) => {
  const { control } = useFormContext()
  return (
    <div className="space-y-2">
        {label && <Label htmlFor={name}>{label}</Label>}
        <PhoneInputWithCountry
            name={name}
            control={control}
            international
            defaultCountry="US"
            inputComponent={Input}
            id={name}
            {...props}
        />
    </div>
  )
}

export { PhoneInput }
