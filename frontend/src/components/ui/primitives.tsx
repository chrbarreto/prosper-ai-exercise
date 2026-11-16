import * as React from 'react'
import { Slot } from '@radix-ui/react-slot'
import * as LabelPrimitive from '@radix-ui/react-label'
import * as AlertDialog from '@radix-ui/react-alert-dialog'
import { cva, type VariantProps } from 'class-variance-authority'
import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'
export function cn(...inputs: ClassValue[]) { return twMerge(clsx(inputs)) }
const buttonVariants = cva('inline-flex h-8 shrink-0 items-center justify-center gap-2 rounded-md px-3 text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4', {
  variants: { variant: { default: 'bg-indigo-600 text-white hover:bg-indigo-700', outline: 'border border-slate-200 bg-white hover:bg-slate-50', ghost: 'hover:bg-slate-100', destructive: 'bg-red-600 text-white hover:bg-red-700' } }, defaultVariants: { variant: 'default' },
})
export function Button({ className, variant, asChild = false, ...props }: React.ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : 'button'
  return <Comp className={cn(buttonVariants({ variant }), className)} {...props}/>
}
export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn('h-8 w-full min-w-0 rounded-md border border-slate-200 bg-white px-3 text-sm placeholder:text-slate-400 disabled:bg-slate-50', className)} {...props}/>
}
export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn('min-h-24 w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 placeholder:text-slate-400', className)} {...props}/>
}
export function Label(props: React.ComponentProps<typeof LabelPrimitive.Root>) {
  return <LabelPrimitive.Root className="text-xs font-medium text-slate-600" {...props}/>
}
export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn('h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-sm', className)} {...props}/>
}
export function ConfirmDialog({ confirmation, onClose }: { confirmation: { title: string; description: string; action: () => void | Promise<void> } | null; onClose: () => void }) {
  const [busy, setBusy] = React.useState(false)
  return <AlertDialog.Root open={!!confirmation} onOpenChange={open => { if (!open && !busy) onClose() }}>
    <AlertDialog.Portal><AlertDialog.Overlay className="fixed inset-0 z-50 bg-slate-950/30"/>
      <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 w-96 -translate-x-1/2 -translate-y-1/2 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <AlertDialog.Title className="text-base font-medium">{confirmation?.title}</AlertDialog.Title>
        <AlertDialog.Description className="mt-2 text-sm leading-6 text-slate-500">{confirmation?.description}</AlertDialog.Description>
        <div className="mt-4 flex justify-end gap-2"><AlertDialog.Cancel asChild><Button disabled={busy} variant="outline">Cancel</Button></AlertDialog.Cancel><Button disabled={busy} variant="destructive" onClick={async () => { setBusy(true); try { await confirmation?.action(); onClose() } finally { setBusy(false) } }}>{busy ? 'Deleting…' : 'Confirm'}</Button></div>
      </AlertDialog.Content>
    </AlertDialog.Portal>
  </AlertDialog.Root>
}
