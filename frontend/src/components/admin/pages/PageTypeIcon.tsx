import { FileText, CheckCircle, FormInput, Settings } from 'lucide-react';

interface PageTypeIconProps {
  type: 'landing' | 'thankyou' | 'form' | 'admin';
  className?: string;
}

const typeConfig = {
  landing: {
    icon: FileText,
    label: 'Landing Page',
    color: 'text-blue-500',
  },
  thankyou: {
    icon: CheckCircle,
    label: 'Thank You',
    color: 'text-green-500',
  },
  form: {
    icon: FormInput,
    label: 'Formulário',
    color: 'text-purple-500',
  },
  admin: {
    icon: Settings,
    label: 'Admin',
    color: 'text-orange-500',
  },
};

export function PageTypeIcon({ type, className = '' }: PageTypeIconProps) {
  const config = typeConfig[type];
  const Icon = config.icon;

  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <Icon className={`h-4 w-4 ${config.color}`} />
      <span className="text-sm text-muted-foreground">{config.label}</span>
    </div>
  );
}
