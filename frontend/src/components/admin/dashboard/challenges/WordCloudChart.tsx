import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TagCloud } from 'react-tagcloud';
import { Cloud } from 'lucide-react';
import { useMemo } from 'react';

interface WordCloudChartProps {
  data: Array<{ keyword: string; count: number }>;
}

// Color palette based on design tokens
const colors = [
  'hsl(262, 83%, 58%)', // violet-500
  'hsl(263, 70%, 50%)', // violet-600
  'hsl(250, 95%, 64%)', // indigo-500
  'hsl(217, 91%, 60%)', // blue-500
  'hsl(199, 89%, 48%)', // cyan-500
  'hsl(280, 87%, 65%)', // purple-500
  'hsl(292, 91%, 73%)', // fuchsia-400
];

export function WordCloudChart({ data }: WordCloudChartProps) {
  const cloudData = useMemo(() => {
    return data.slice(0, 50).map((item, index) => ({
      value: item.keyword,
      count: item.count,
      key: `${item.keyword}-${index}`,
      color: colors[index % colors.length],
    }));
  }, [data]);

  const customRenderer = (tag: any, size: number, color: string) => {
    const fontSize = 12 + size * 4;
    return (
      <span
        key={tag.key}
        style={{
          color: tag.color || color,
          fontSize: `${fontSize}px`,
          margin: '3px',
          padding: '2px 6px',
          display: 'inline-block',
          cursor: 'default',
          fontWeight: size > 3 ? 600 : 400,
          opacity: 0.7 + (size / 10),
          transition: 'all 0.2s ease',
        }}
        className="hover:opacity-100 hover:scale-110"
        title={`${tag.value}: ${tag.count} menções`}
      >
        {tag.value}
      </span>
    );
  };

  if (!data.length) {
    return (
      <Card className="bg-gradient-to-br from-card via-card to-violet-950/10 border-border/50 shadow-lg">
        <CardHeader className="pb-2">
          <CardTitle className="flex items-center gap-2 text-lg">
            <div className="p-2 rounded-lg bg-violet-500/20">
              <Cloud className="h-5 w-5 text-violet-400" />
            </div>
            Nuvem de Palavras
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px] flex items-center justify-center text-muted-foreground">
            Sem dados de desafios disponíveis
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-gradient-to-br from-card via-card to-violet-950/10 border-border/50 shadow-lg overflow-hidden">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-lg">
          <div className="p-2 rounded-lg bg-violet-500/20">
            <Cloud className="h-5 w-5 text-violet-400" />
          </div>
          Nuvem de Palavras
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[300px] flex items-center justify-center overflow-hidden">
          <TagCloud
            minSize={1}
            maxSize={6}
            tags={cloudData}
            renderer={customRenderer}
            className="text-center leading-relaxed"
          />
        </div>
      </CardContent>
    </Card>
  );
}
